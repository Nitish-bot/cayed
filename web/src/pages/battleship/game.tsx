import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchMaybePlayerBoard,
  type Game,
  type PlayerBoard,
  type ShipCoordinatesArgs,
} from '@client/cayed';
import { address, isSome, type Address } from '@solana/kit';
import { useSignMessage, useWalletAccountTransactionSigner } from '@solana/react';
import { type SolanaSignMessageInput } from '@solana/wallet-standard-features';
import { type UiWalletAccount } from '@wallet-standard/react';
import { useParams } from 'react-router';

import { ChainContext } from '@/context/chain-context';
import { useGameService } from '@/context/game-service-provider';
import { SelectedWalletAccountContext } from '@/context/selected-wallet-account-context';
import { useClipboard } from '@/hooks/use-clipboard';
import { getHitCells, getMissCells } from '@/lib/bitmask';
import { getShipSizes } from '@/lib/constants';
import {
  buildShip,
  cellKey,
  getShipCells,
  validateShipPlacement,
  type CellCoord,
} from '@/lib/ships';
import {
  AwaitingOpponentStage,
  BattleStage,
  ErrorStage,
  FinishedStage,
  LoadingStage,
  PlacementStage,
  RevealedStage,
  WaitingShipsStage,
} from '@/pages/battleship/stages';
import { fetchGameAccount } from '@/services/fetch-accounts';
import { deriveGamePda, derivePlayerBoardPda } from '@/services/pda';

const POLL_MS = 3000;
const ERROR_DISMISS_MS = 6000;

export function BattleshipGame() {
  const { gameId: gameIdStr } = useParams<{ gameId: string }>();
  const [selectedWalletAccount] = useContext(SelectedWalletAccountContext);

  if (!selectedWalletAccount) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-arcade-muted font-pixel text-[10px] tracking-wider uppercase">
          CONNECT WALLET TO PLAY
        </p>
      </div>
    );
  }

  return (
    <BattleshipGameInner account={selectedWalletAccount} gameIdStr={gameIdStr ?? '0'} />
  );
}

function BattleshipGameInner({
  account,
  gameIdStr,
}: {
  account: UiWalletAccount;
  gameIdStr: string;
}) {
  const { chain } = useContext(ChainContext);
  const signer = useWalletAccountTransactionSigner(account, chain);

  const gameId = useMemo(() => BigInt(gameIdStr ?? '0'), [gameIdStr]);

  // ── State ──
  const [game, setGame] = useState<Game | null>(null);
  const [myBoard, setMyBoard] = useState<PlayerBoard | null>(null);
  const [opponentBoard, setOpponentBoard] = useState<PlayerBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [revealing, setRevealing] = useState(false);

  // Ship placement state
  const [placedShips, setPlacedShips] = useState<ShipCoordinatesArgs[]>([]);
  const [currentShipIdx, setCurrentShipIdx] = useState(0);
  const [orientation, setOrientation] = useState<'h' | 'v'>('h');
  const [hoveredCell, setHoveredCell] = useState<CellCoord | null>(null);

  const gameService = useGameService();
  const { copied, copy } = useClipboard();
  const signMessage = useSignMessage(account);

  // ── Derived ──
  const myAddress = address(account.address);
  const isPlayer1 = game?.player1 === myAddress;
  const isPlayer2 = game && isSome(game.player2) && game.player2.value === myAddress;
  const isPlayer = isPlayer1 || isPlayer2;
  const opponentAddress = isPlayer1
    ? game && isSome(game.player2)
      ? game.player2.value
      : null
    : (game?.player1 ?? null);

  // FIX: Turn detection based on total moves (mirrors on-chain logic)
  const totalMoves = game?.moves.length ?? 0;
  const isPlayer1Turn = game ? (totalMoves % 2 === 0) === game.nextMovePlayer1 : false;
  const isMyTurn =
    game && ((isPlayer1 && isPlayer1Turn) || (isPlayer2 && !isPlayer1Turn));

  const shipSizes = useMemo(() => (game ? getShipSizes(game.gridSize) : []), [game]);
  const myShipsPlaced = myBoard ? myBoard.shipCoordinates.length > 0 : false;
  const opponentShipsPlaced = opponentBoard
    ? opponentBoard.shipCoordinates.length > 0
    : false;
  const status = game?.status.__kind;
  const isPlacing = status === 'HidingShips' && !myShipsPlaced;

  // ── PDA derivation ──
  const pdaRef = useRef<{
    gamePda: Address | null;
    myBoardPda: Address | null;
    opponentBoardPda: Address | null;
  }>({ gamePda: null, myBoardPda: null, opponentBoardPda: null });

  useEffect(() => {
    if (!myAddress) return;
    let cancelled = false;
    async function derive() {
      const gamePda = await deriveGamePda(gameId);
      if (cancelled) return;
      pdaRef.current.gamePda = gamePda;

      const myBoardPda = await derivePlayerBoardPda(gameId, myAddress);
      if (cancelled) return;
      pdaRef.current.myBoardPda = myBoardPda;
    }
    void derive();
    return () => {
      cancelled = true;
    };
  }, [gameId, myAddress]);

  // Derive opponent board PDA when we know the opponent
  useEffect(() => {
    if (!opponentAddress) return;
    let cancelled = false;
    async function derive() {
      const opponentBoardPda = await derivePlayerBoardPda(gameId, opponentAddress!);
      if (cancelled) return;
      pdaRef.current.opponentBoardPda = opponentBoardPda;
    }
    void derive();
    return () => {
      cancelled = true;
    };
  }, [gameId, opponentAddress]);

  // ── Fetch game state ──
  const fetchState = useCallback(async () => {
    try {
      if (!pdaRef.current.gamePda) return;

      let maybeGame;
      try {
        maybeGame = await fetchGameAccount(gameService.devnet, pdaRef.current.gamePda);
        if (!maybeGame.exists) {
          // Game not found on base layer — likely delegated to ER after p2 joined
          maybeGame = await fetchGameAccount(
            gameService.ephemeral,
            pdaRef.current.gamePda
          );
        }
      } catch (baseErr) {
        try {
          maybeGame = await fetchGameAccount(
            gameService.ephemeral,
            pdaRef.current.gamePda
          );
        } catch (ephErr) {
          console.error('Could not find game on base or ephemeral', baseErr, ephErr);
          setError('Game not found');
          return;
        }
      }

      if (!maybeGame?.exists) {
        setError('Game account not found — it may still be confirming');
        return;
      }

      setGame(maybeGame.data);

      // Board PDAs are delegated to the ER during gameplay (independently of the
      // game PDA which is only delegated after P2 joins).
      // Try devnet first (no auth needed). If the board is delegated, devnet will
      // either return a delegation buffer that fails to decode or return exists:false.
      // In that case, ensure we're authed and try the ephemeral endpoint.
      const tryFetchBoard = async (pda: Address) => {
        try {
          const board = await fetchMaybePlayerBoard(gameService.devnet.rpc, pda);
          if (board.exists) return board;
        } catch {
          /* delegation buffer — can't decode on devnet */
        }
        try {
          await gameService.ensureAuthenticated();
          const board = await fetchMaybePlayerBoard(gameService.ephemeral.rpc, pda);
          if (board.exists) return board;
        } catch {
          /* not on ephemeral either */
        }
        return null;
      };

      // Fetch my board
      if (pdaRef.current.myBoardPda) {
        const board = await tryFetchBoard(pdaRef.current.myBoardPda);
        if (board?.exists) setMyBoard(board.data);
      }

      // Fetch opponent board
      if (pdaRef.current.opponentBoardPda) {
        const board = await tryFetchBoard(pdaRef.current.opponentBoardPda);
        if (board?.exists) setOpponentBoard(board.data);
      }
    } catch (err) {
      console.error('Fetch state error:', err);
    }
  }, [gameService]);

  // ── Register sign-message function with GameService (once) ──
  useEffect(() => {
    gameService.setSignMessageFn(
      myAddress,
      async (message: Uint8Array): Promise<Uint8Array> => {
        const input = { account, message } as SolanaSignMessageInput;
        const output = await signMessage(input);
        return output.signature;
      }
    );
  }, [gameService, myAddress, account, signMessage]);

  // ── Poll state ──
  useEffect(() => {
    // Initial fetch after PDAs are derived
    const timer = setTimeout(() => void fetchState(), 500);
    const interval = setInterval(() => void fetchState(), POLL_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchState]);

  // ── Extract my attacks from game.moves ──
  // On-chain, moves are stored in alternating order.
  // If nextMovePlayer1=true, moves[0]=P1's attack, moves[1]=P2's, etc.
  // "My attacks" are the moves I made (every other move starting from my offset).
  const myAttacks = useMemo(() => {
    if (!game) return new Map<string, 'hit' | 'miss'>();
    const map = new Map<string, 'hit' | 'miss'>();
    // My attacks start at index 0 if I go first, 1 if opponent goes first
    const myStartIdx = isPlayer1 === game.nextMovePlayer1 ? 0 : 1;
    for (let i = myStartIdx; i < game.moves.length; i += 2) {
      const move = game.moves[i]!;
      map.set(cellKey(move.x, move.y), move.isHit ? 'hit' : 'miss');
    }
    return map;
  }, [game, isPlayer1]);

  // ── Ship placement preview ──
  const previewShip = useMemo(() => {
    if (!isPlacing || !hoveredCell || currentShipIdx >= shipSizes.length || !game)
      return null;
    const size = shipSizes[currentShipIdx];
    const ship = buildShip(hoveredCell.x, hoveredCell.y, size, orientation);
    const valid = validateShipPlacement(ship, game.gridSize, placedShips);
    return { cells: getShipCells(ship), valid, ship };
  }, [isPlacing, hoveredCell, currentShipIdx, shipSizes, orientation, placedShips, game]);

  // ── Handle ship placement click ──
  const handlePlacementClick = useCallback(
    (coord: CellCoord) => {
      if (currentShipIdx >= shipSizes.length || !game) return;
      const size = shipSizes[currentShipIdx];
      const ship = buildShip(coord.x, coord.y, size, orientation);
      if (!validateShipPlacement(ship, game.gridSize, placedShips)) return;
      setPlacedShips([...placedShips, ship]);
      setCurrentShipIdx(currentShipIdx + 1);
    },
    [currentShipIdx, shipSizes, orientation, placedShips, game]
  );

  // ── Submit ships ──
  const handleDeployFleet = useCallback(async () => {
    if (!signer || !pdaRef.current.gamePda || !pdaRef.current.myBoardPda) return;
    setSending(true);
    try {
      await gameService.hideShips({
        player: signer,
        gamePda: pdaRef.current.gamePda,
        playerBoardPda: pdaRef.current.myBoardPda,
        ships: placedShips,
        waitForPermission: true,
      });

      // Optimistically mark ships as placed so we exit placement phase
      // immediately, without waiting for the next poll to read from the ER.
      setMyBoard(prev => ({
        discriminator: prev?.discriminator ?? new Uint8Array(8),
        gameId: prev?.gameId ?? gameId,
        player: prev?.player ?? myAddress,
        bump: prev?.bump ?? 0,
        shipCoordinates: placedShips,
        shipMasks: prev?.shipMasks ?? [],
        allShipsMask: prev?.allShipsMask ?? 0n,
        hitsBitmap: prev?.hitsBitmap ?? 0n,
        sunkMask: prev?.sunkMask ?? 0,
      }));

      // Refresh state
      await fetchState();
    } catch (err) {
      console.error('Hide ships error:', err);
      setError(`Failed to deploy fleet: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }, [signer, placedShips, gameId, myAddress, gameService, fetchState]);

  // ── Handle attack click ──
  const handleAttack = useCallback(
    async (coord: CellCoord) => {
      if (
        !signer ||
        !isMyTurn ||
        sending ||
        !opponentAddress ||
        !pdaRef.current.gamePda ||
        !pdaRef.current.myBoardPda ||
        !pdaRef.current.opponentBoardPda
      )
        return;

      const key = cellKey(coord.x, coord.y);
      if (myAttacks.has(key)) {
        setError('Already attacked this cell!');
        return;
      }

      setSending(true);
      setError(null);
      try {
        await gameService.makeMove({
          player: signer,
          opponent: opponentAddress!,
          gamePda: pdaRef.current.gamePda,
          playerBoardPda: pdaRef.current.myBoardPda,
          opponentBoardPda: pdaRef.current.opponentBoardPda,
          x: coord.x,
          y: coord.y,
        });

        // Refresh to get hit/miss result
        await fetchState();
      } catch (err) {
        console.error('Attack error:', err);
        setError(`Attack failed: ${(err as Error).message}`);
      } finally {
        setSending(false);
      }
    },
    [signer, isMyTurn, sending, opponentAddress, myAttacks, gameService, fetchState]
  );

  // ── Reveal winner (auto or manual) ──
  const handleRevealWinner = useCallback(async () => {
    if (
      !signer ||
      !pdaRef.current.gamePda ||
      !pdaRef.current.myBoardPda ||
      !pdaRef.current.opponentBoardPda
    )
      return;
    setRevealing(true);
    try {
      await gameService.revealWinner({
        payer: signer,
        gamePda: pdaRef.current.gamePda,
        player1BoardPda: isPlayer1
          ? pdaRef.current.myBoardPda
          : pdaRef.current.opponentBoardPda,
        player2BoardPda: isPlayer1
          ? pdaRef.current.opponentBoardPda
          : pdaRef.current.myBoardPda,
      });
      await fetchState();
    } catch (err) {
      console.error('Reveal winner error:', err);
      setError(`Reveal failed: ${(err as Error).message}`);
    } finally {
      setRevealing(false);
    }
  }, [signer, isPlayer1, gameService, fetchState]);

  // ── Keyboard shortcut: R to rotate ships ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        if (isPlacing) {
          setOrientation(o => (o === 'h' ? 'v' : 'h'));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPlacing]);

  // ── Auto-dismiss errors ──
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [error]);

  // ── Render helpers ──
  const myBoardHits: CellCoord[] = useMemo(() => {
    if (!myBoard) return [];
    return getHitCells(myBoard, game?.gridSize ?? 0);
  }, [myBoard, game]);

  const myBoardMisses: CellCoord[] = useMemo(() => {
    if (!myBoard) return [];
    return getMissCells(myBoard, game?.gridSize ?? 0);
  }, [myBoard, game]);
  const attackHits: CellCoord[] = useMemo(
    () =>
      [...myAttacks.entries()]
        .filter(([, v]) => v === 'hit')
        .map(([k]) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y! };
        }),
    [myAttacks]
  );

  const attackMisses: CellCoord[] = useMemo(
    () =>
      [...myAttacks.entries()]
        .filter(([, v]) => v === 'miss')
        .map(([k]) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y! };
        }),
    [myAttacks]
  );

  const winner =
    game?.status.__kind === 'Completed'
      ? game.status.winner
      : game?.status.__kind === 'WinnerRevealed'
        ? game.status.winner
        : null;

  // Game link for sharing
  const gameLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/cayed/battleship/${gameIdStr}`
      : '';

  // ═══════════════════════════════════════
  // ── RENDER ──
  // ═══════════════════════════════════════

  if (!game && !error) return <LoadingStage />;
  if (error && !game) return <ErrorStage error={error} />;
  if (!game) return <LoadingStage />;

  const stageBase = {
    game,
    gameIdStr,
    myAddress,
    isPlayer1,
    isPlayer2,
    isPlayer,
  };

  if (status === 'AwaitingPlayerTwo') {
    return (
      <AwaitingOpponentStage
        {...stageBase}
        gameLink={gameLink}
        copied={copied}
        copy={copy}
      />
    );
  }

  if (status === 'HidingShips' && !myShipsPlaced) {
    const allPlaced = currentShipIdx >= shipSizes.length;
    return (
      <PlacementStage
        {...stageBase}
        shipSizes={shipSizes}
        placedShips={placedShips}
        currentShipIdx={currentShipIdx}
        orientation={orientation}
        previewCells={previewShip?.cells ?? []}
        previewValid={previewShip?.valid ?? false}
        allPlaced={allPlaced}
        sending={sending}
        onPlacementClick={handlePlacementClick}
        onCellHover={setHoveredCell}
        onRotate={() => setOrientation(o => (o === 'h' ? 'v' : 'h'))}
        onUndo={() => {
          setPlacedShips(placedShips.slice(0, -1));
          setCurrentShipIdx(currentShipIdx - 1);
        }}
        onDeploy={handleDeployFleet}
      />
    );
  }

  if (status === 'HidingShips' && !opponentShipsPlaced) {
    return <WaitingShipsStage {...stageBase} myBoard={myBoard} />;
  }

  if (status === 'HidingShips' || status === 'InProgress') {
    return (
      <BattleStage
        {...stageBase}
        myBoard={myBoard}
        opponentBoard={opponentBoard}
        isMyTurn={isMyTurn}
        sending={sending}
        error={error}
        totalMoves={totalMoves}
        myBoardHits={myBoardHits}
        myBoardMisses={myBoardMisses}
        attackHits={attackHits}
        attackMisses={attackMisses}
        onAttack={handleAttack}
      />
    );
  }

  if (status === 'Completed') {
    return (
      <FinishedStage
        {...stageBase}
        winner={winner}
        revealing={revealing}
        error={error}
        onRevealWinner={handleRevealWinner}
      />
    );
  }

  if (status === 'WinnerRevealed') {
    return (
      <RevealedStage
        {...stageBase}
        winner={winner}
        myBoardHits={myBoardHits}
        attackHits={attackHits}
      />
    );
  }

  // Fallback
  return <LoadingStage />;
}
