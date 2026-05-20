import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { fetchMaybePlayerBoard, type ShipCoordinatesArgs } from '@client/cayed';
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
  pickAuthoritativeGame,
  toUiGame,
  toUiPlayerBoard,
  type UiGame,
  type UiPlayerBoard,
} from '@/lib/ui-accounts';
import {
  AwaitingOpponentStage,
  BattleStage,
  ErrorStage,
  FinishedStage,
  LoadingStage,
  PlacementStage,
  RevealedStage,
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

  const gameId = useMemo(() => Number(gameIdStr ?? '0'), [gameIdStr]);

  // ── State ──
  const [game, setGame] = useState<UiGame | null>(null);
  const [myBoard, setMyBoard] = useState<UiPlayerBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [revealing, setRevealing] = useState(false);
  /** Set after a successful hideShips tx; ER privacy blocks reading opponent boards via RPC. */
  const [fleetDeployed, setFleetDeployed] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<CellCoord | null>(null);

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

  useEffect(() => {
    if (myBoard && myBoard.shipCoordinates.length > 0) {
      setFleetDeployed(true);
    }
  }, [myBoard]);

  const shipSizes = useMemo(() => (game ? getShipSizes(game.gridSize) : []), [game]);
  const myShipsPlaced =
    fleetDeployed || (myBoard ? myBoard.shipCoordinates.length > 0 : false);
  const status = game?.status.__kind;
  const gameOver =
    status === 'Completed' ||
    status === 'Forfeited' ||
    status === 'WinnerRevealed' ||
    status === 'Cancelled';
  const isPlacing = status === 'HidingShips' && !myShipsPlaced;
  const canAttack =
    !gameOver && myShipsPlaced && (status === 'HidingShips' || status === 'InProgress');

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
      const gid = BigInt(gameId);
      const gamePda = await deriveGamePda(gid);
      if (cancelled) return;
      pdaRef.current.gamePda = gamePda;

      const myBoardPda = await derivePlayerBoardPda(gid, myAddress);
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
      const opponentBoardPda = await derivePlayerBoardPda(
        BigInt(gameId),
        opponentAddress!
      );
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

      // During play the Game PDA lives on the ER; devnet is stale until a ship sinks.
      await gameService.ensureAuthenticated();
      const [ephGame, baseGame] = await Promise.all([
        fetchGameAccount(gameService.ephemeral, pdaRef.current.gamePda),
        fetchGameAccount(gameService.devnet, pdaRef.current.gamePda),
      ]);
      const maybeGame = pickAuthoritativeGame(ephGame, baseGame);

      if (!maybeGame?.exists) {
        setError('Game account not found — it may still be confirming');
        return;
      }

      setGame(toUiGame(maybeGame.data));

      // Board PDAs are delegated to the ER during gameplay (independently of the
      // game PDA which is only delegated after P2 joins).
      // Boards are delegated to the ER at game creation, so the ephemeral
      // validator has the live state. Devnet holds a stale pre-delegation
      // snapshot or an undecodable delegation buffer — try ephemeral first.
      const tryFetchBoard = async (pda: Address) => {
        try {
          await gameService.ensureAuthenticated();
          const board = await fetchMaybePlayerBoard(gameService.ephemeral.rpc, pda);
          if (board.exists) return board;
        } catch {
          /* auth not ready or not on ephemeral yet */
        }
        try {
          const board = await fetchMaybePlayerBoard(gameService.devnet.rpc, pda);
          if (board.exists) return board;
        } catch {
          /* delegation buffer — can't decode on devnet */
        }
        return null;
      };

      // Fetch my board — don't overwrite optimistic ship placement with stale data
      if (pdaRef.current.myBoardPda) {
        const board = await tryFetchBoard(pdaRef.current.myBoardPda);
        if (board?.exists) {
          setMyBoard(prev => {
            if (
              prev &&
              prev.shipCoordinates.length > 0 &&
              board.data.shipCoordinates.length === 0
            ) {
              return prev;
            }
            return toUiPlayerBoard(board.data);
          });
        }
      }

      // Opponent PlayerBoard is private on the ER — only the owner can read it via RPC
      // (see tests/cayed.test.ts "player sees own board but not opponent"). Attacks use
      // public Game.moves; make_move reads opponent board inside the ER validator.
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

      setFleetDeployed(true);

      // Optimistically mark ships as placed so we exit placement phase
      // immediately, without waiting for the next poll to read from the ER.
      setMyBoard(prev => ({
        discriminator: prev?.discriminator ?? new Uint8Array(8),
        gameId: prev?.gameId ?? gameId,
        player: prev?.player ?? myAddress,
        bump: prev?.bump ?? 0,
        shipCoordinates: placedShips,
        shipMasks: prev?.shipMasks ?? [],
        allShipsMask: prev?.allShipsMask ?? 0,
        hitsBitmap: prev?.hitsBitmap ?? 0,
        sunkMask: prev?.sunkMask ?? 0,
      }));

      await fetchState();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error('Hide ships error:', err);
      if (/ships already placed|ShipsAlreadyPlaced/i.test(msg)) {
        setFleetDeployed(true);
        return;
      }
      setError(`Failed to deploy fleet: ${msg}`);
    } finally {
      setSending(false);
    }
  }, [signer, placedShips, gameId, myAddress, gameService, fetchState]);

  // Clear target when it is no longer our turn
  useEffect(() => {
    if (!isMyTurn) setSelectedTarget(null);
  }, [isMyTurn]);

  const handleSelectTarget = useCallback(
    (coord: CellCoord) => {
      if (sending) return;
      if (!canAttack || gameOver) return;
      if (!isMyTurn) {
        setError('Wait for your turn.');
        return;
      }
      const key = cellKey(coord.x, coord.y);
      if (myAttacks.has(key)) {
        setError('Already attacked this cell!');
        return;
      }
      setError(null);
      setSelectedTarget(coord);
    },
    [isMyTurn, sending, myAttacks, canAttack, gameOver]
  );

  const handleFire = useCallback(async () => {
    if (
      !signer ||
      gameOver ||
      !isMyTurn ||
      sending ||
      !selectedTarget ||
      !opponentAddress ||
      !pdaRef.current.gamePda ||
      !pdaRef.current.myBoardPda ||
      !pdaRef.current.opponentBoardPda
    )
      return;

    setSending(true);
    setError(null);
    try {
      await gameService.makeMove({
        player: signer,
        opponent: opponentAddress,
        gamePda: pdaRef.current.gamePda,
        playerBoardPda: pdaRef.current.myBoardPda,
        opponentBoardPda: pdaRef.current.opponentBoardPda,
        x: selectedTarget.x,
        y: selectedTarget.y,
      });

      setSelectedTarget(null);
      await fetchState();
    } catch (err) {
      console.error('Attack error:', err);
      const msg = (err as Error).message ?? String(err);
      if (/ships not placed|ShipsNotPlaced/i.test(msg)) {
        setError('Opponent has not finished deploying their fleet yet.');
      } else if (/invalid turn|InvalidTurn/i.test(msg)) {
        setError("It's not your turn — refreshing state.");
        await fetchState();
      } else if (/cell already attacked|CellAlreadyAttacked/i.test(msg)) {
        setError('You already attacked that cell.');
        await fetchState();
      } else if (
        /invalid game status|InvalidGameStatus|game.*completed|AllShipsSunk/i.test(msg)
      ) {
        setError('Game is over — refreshing state.');
        await fetchState();
      } else if (/websocket|ws |socket|subscription/i.test(msg)) {
        setError('Network error while confirming — checking if your shot landed…');
        await fetchState();
      } else {
        setError(`Attack failed: ${msg}`);
      }
    } finally {
      setSending(false);
    }
  }, [
    signer,
    isMyTurn,
    sending,
    selectedTarget,
    opponentAddress,
    gameOver,
    gameService,
    fetchState,
  ]);

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
        deployDisabled={fleetDeployed}
      />
    );
  }

  if (status === 'HidingShips' || status === 'InProgress') {
    return (
      <BattleStage
        {...stageBase}
        myBoard={myBoard}
        isMyTurn={isMyTurn}
        canAttack={canAttack}
        sending={sending}
        error={error}
        totalMoves={totalMoves}
        myBoardHits={myBoardHits}
        myBoardMisses={myBoardMisses}
        attackHits={attackHits}
        attackMisses={attackMisses}
        selectedTarget={selectedTarget}
        onSelectTarget={handleSelectTarget}
        onFire={handleFire}
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
