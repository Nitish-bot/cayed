import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchMaybePlayerBoard,
  type Game,
  type PlayerBoard,
  type ShipCoordinatesArgs,
} from '@client/cayed';
import { address, isSome, type Address } from '@solana/kit';
import { useWalletAccountTransactionSigner } from '@solana/react';
import { type UiWalletAccount } from '@wallet-standard/react';
import { useNavigate, useParams } from 'react-router';

import { GameGrid } from '@/components/battleship/game-grid';
import { ChainContext } from '@/context/chain-context';
import { useGameService } from '@/context/game-service-provider';
import { SelectedWalletAccountContext } from '@/context/selected-wallet-account-context';
import { useClipboard } from '@/hooks/use-clipboard';
import { getHitCells, getMissCells } from '@/lib/bitmask';
import { formatSol, getShipSizes, gridDisplay, truncateAddress } from '@/lib/constants';
import {
  buildShip,
  cellKey,
  getShipCells,
  validateShipPlacement,
  type CellCoord,
} from '@/lib/ships';
import { fetchGameAccount } from '@/services/fetch-accounts';
import { deriveGamePda, derivePlayerBoardPda } from '@/services/pda';

type GamePhase =
  | 'loading'
  | 'waiting'
  | 'placement'
  | 'waiting-opponent-ships'
  | 'battle'
  | 'finished'
  | 'revealed';

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
  const navigate = useNavigate();
  const { chain } = useContext(ChainContext);
  const signer = useWalletAccountTransactionSigner(account, chain);

  const gameId = useMemo(() => BigInt(gameIdStr ?? '0'), [gameIdStr]);

  // ── State ──
  const [game, setGame] = useState<Game | null>(null);
  const [myBoard, setMyBoard] = useState<PlayerBoard | null>(null);
  const [opponentBoard, setOpponentBoard] = useState<PlayerBoard | null>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
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

      let ephemeral = false;
      let maybeGame;
      try {
        maybeGame = await fetchGameAccount(gameService.devnet, pdaRef.current.gamePda);
        if (!maybeGame.exists) {
          // Game not found on base layer — likely delegated to ER after p2 joined
          ephemeral = true;
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
          ephemeral = true;
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
      const rpc = ephemeral ? gameService.ephemeral.rpc : gameService.devnet.rpc;
      // Fetch my board
      if (pdaRef.current.myBoardPda) {
        try {
          const maybeBoard = await fetchMaybePlayerBoard(rpc, pdaRef.current.myBoardPda);
          if (maybeBoard.exists) setMyBoard(maybeBoard.data);
        } catch {
          /* board may not exist yet */
        }
      }

      // Fetch opponent board (base layer only — no privacy)
      if (pdaRef.current.opponentBoardPda) {
        try {
          const maybeBoard = await fetchMaybePlayerBoard(
            rpc,
            pdaRef.current.opponentBoardPda
          );
          if (maybeBoard.exists) setOpponentBoard(maybeBoard.data);
        } catch {
          /* board may not exist yet */
        }
      }
    } catch (err) {
      console.error('Fetch state error:', err);
    }
  }, [gameService]);

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

  // ── Phase detection ──
  useEffect(() => {
    if (!game) {
      setPhase('loading');
      return;
    }

    const status = game.status.__kind;

    if (status === 'WinnerRevealed') {
      setPhase('revealed');
      return;
    }

    if (status === 'Completed') {
      setPhase('finished');
      return;
    }

    if (status === 'AwaitingPlayerTwo') {
      setPhase('waiting');
      return;
    }

    if (status === 'HidingShips') {
      // If MY ships are already placed, show waiting state
      if (myShipsPlaced) {
        setPhase('waiting-opponent-ships');
      } else {
        setPhase('placement');
      }
      return;
    }

    if (status === 'InProgress') {
      setPhase('battle');
      return;
    }

    setPhase('loading');
  }, [game, myBoard, isPlayer, myShipsPlaced]);

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
    if (
      phase !== 'placement' ||
      !hoveredCell ||
      currentShipIdx >= shipSizes.length ||
      !game
    )
      return null;
    const size = shipSizes[currentShipIdx];
    const ship = buildShip(hoveredCell.x, hoveredCell.y, size, orientation);
    const valid = validateShipPlacement(ship, game.gridSize, placedShips);
    return { cells: getShipCells(ship), valid, ship };
  }, [phase, hoveredCell, currentShipIdx, shipSizes, orientation, placedShips, game]);

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
      });

      // Refresh state
      await fetchState();
    } catch (err) {
      console.error('Hide ships error:', err);
      setError(`Failed to deploy fleet: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }, [signer, placedShips, gameService, fetchState]);

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
        if (phase === 'placement') {
          setOrientation(o => (o === 'h' ? 'v' : 'h'));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase]);

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

  if (!game && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-arcade-cyan font-pixel animate-pixel-blink text-[10px] tracking-widest uppercase">
            LOADING GAME...
          </p>
        </div>
      </div>
    );
  }

  if (error && !game) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-arcade-red font-pixel text-[10px]">{error}</p>
          <button
            onClick={() => navigate('/battleship')}
            className="text-arcade-cyan font-pixel mt-6 text-[8px] uppercase hover:underline"
          >
            &lt; BACK TO LOBBY
          </button>
        </div>
      </div>
    );
  }

  // ── LOADING ──
  if (phase === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-arcade-cyan font-pixel animate-pixel-blink text-[10px] tracking-widest uppercase">
          LOADING GAME...
        </p>
      </div>
    );
  }

  // ── WAITING FOR OPPONENT ──
  if (phase === 'waiting') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-arcade-muted font-pixel mb-2 text-[8px] uppercase">
          GAME #{gameIdStr}
        </p>
        <h2 className="text-arcade-yellow font-pixel animate-pixel-blink mb-8 text-sm tracking-widest uppercase">
          AWAITING OPPONENT
        </h2>
        <div className="border-arcade-border bg-arcade-panel mb-6 border-4 p-6">
          <p className="text-arcade-muted font-pixel text-[8px]">
            GRID:{' '}
            <span className="text-arcade-cyan">
              {game ? gridDisplay(game.gridSize) : ''}
            </span>
          </p>
          <p className="text-arcade-muted font-pixel mt-3 text-[8px]">
            WAGER:{' '}
            <span className="text-arcade-yellow">
              {game ? formatSol(game.wager) : '0'} SOL
            </span>
          </p>
        </div>

        {/* Copy game link */}
        <button
          onClick={() => copy(gameLink)}
          className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg font-pixel mx-auto mb-6 block border-4 px-6 py-3 text-[8px] uppercase transition-none active:scale-95"
        >
          {copied ? '✓ LINK COPIED!' : '⎘ COPY GAME LINK'}
        </button>

        <p className="text-arcade-muted font-pixel text-[7px]">
          SHARE LINK TO FIND AN OPPONENT
        </p>
        <button
          onClick={() => navigate('/battleship')}
          className="text-arcade-muted hover:text-arcade-cyan font-pixel mt-8 text-[8px]"
        >
          &lt; BACK TO LOBBY
        </button>
      </div>
    );
  }

  // ── SHIP PLACEMENT ──
  if (phase === 'placement' && game) {
    const allPlaced = currentShipIdx >= shipSizes.length;

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h2 className="text-arcade-cyan font-pixel mb-6 text-center text-xs tracking-widest uppercase">
          DEPLOY YOUR FLEET
        </h2>

        {/* Ship list */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          {shipSizes.map((size, idx) => (
            <div
              key={idx}
              className={`font-pixel border-4 px-3 py-1.5 text-[7px] uppercase ${
                idx < currentShipIdx
                  ? 'border-arcade-green text-arcade-green'
                  : idx === currentShipIdx
                    ? 'border-arcade-cyan text-arcade-cyan animate-pixel-blink'
                    : 'border-arcade-border text-arcade-muted'
              }`}
            >
              {idx < currentShipIdx ? '✓ ' : ''}
              {size === 1
                ? 'SCOUT'
                : size === 2
                  ? 'PATROL'
                  : size === 3
                    ? 'CRUISER'
                    : size === 4
                      ? 'BATTLESHIP'
                      : 'CARRIER'}{' '}
              ({size})
            </div>
          ))}
        </div>

        {/* Controls */}
        {!allPlaced && (
          <div className="mb-4 flex items-center justify-center gap-4">
            <button
              onClick={() => setOrientation(o => (o === 'h' ? 'v' : 'h'))}
              className="border-arcade-border text-arcade-muted hover:border-arcade-cyan hover:text-arcade-cyan font-pixel border-4 px-3 py-1 text-[7px] transition-none"
            >
              {orientation === 'h' ? '→ HORIZONTAL' : '↓ VERTICAL'} [R]
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="flex justify-center">
          <GameGrid
            gridSize={game.gridSize}
            ships={placedShips}
            previewCells={previewShip?.cells ?? []}
            previewValid={previewShip?.valid ?? false}
            interactive={!allPlaced}
            onCellClick={handlePlacementClick}
            onCellHover={setHoveredCell}
            label="YOUR WATERS"
          />
        </div>

        {/* Undo + Deploy */}
        <div className="mt-6 flex items-center justify-center gap-4">
          {placedShips.length > 0 && (
            <button
              onClick={() => {
                setPlacedShips(placedShips.slice(0, -1));
                setCurrentShipIdx(currentShipIdx - 1);
              }}
              className="border-arcade-red text-arcade-red hover:bg-arcade-red hover:text-arcade-bg font-pixel border-4 px-4 py-2 text-[7px] uppercase transition-none"
            >
              UNDO
            </button>
          )}

          {allPlaced && (
            <button
              onClick={handleDeployFleet}
              disabled={sending}
              className="border-arcade-green bg-arcade-green/10 text-arcade-green hover:bg-arcade-green hover:text-arcade-bg font-pixel border-4 px-8 py-3 text-[8px] uppercase transition-none active:scale-95 disabled:opacity-40"
            >
              {sending ? 'DEPLOYING...' : 'DEPLOY FLEET'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── WAITING FOR OPPONENT TO PLACE SHIPS ──
  if (phase === 'waiting-opponent-ships' && game) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h2 className="text-arcade-yellow font-pixel animate-pixel-blink mb-4 text-xs uppercase">
          FLEET DEPLOYED!
        </h2>
        <p className="text-arcade-muted font-pixel text-[8px]">
          WAITING FOR OPPONENT TO DEPLOY THEIR FLEET...
        </p>

        {/* Show my board as read-only */}
        <div className="mt-8 flex justify-center">
          <GameGrid
            gridSize={game.gridSize}
            ships={myBoard?.shipCoordinates ?? []}
            label="YOUR WATERS"
          />
        </div>
      </div>
    );
  }

  // ── BATTLE PHASE ──
  if (phase === 'battle' && game) {
    const opponentReady = opponentBoard && opponentBoard.shipCoordinates.length > 0;

    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Turn indicator */}
        <div className="mb-6 text-center">
          {!opponentReady ? (
            <p className="text-arcade-yellow font-pixel animate-pixel-blink text-[9px] uppercase">
              WAITING FOR OPPONENT TO DEPLOY FLEET...
            </p>
          ) : isMyTurn ? (
            <p className="text-arcade-cyan font-pixel animate-pixel-bounce text-xs uppercase">
              YOUR TURN — FIRE!
            </p>
          ) : (
            <p className="text-arcade-muted font-pixel animate-pixel-blink text-[9px] uppercase">
              OPPONENT IS AIMING...
            </p>
          )}
          {sending && (
            <p className="text-arcade-yellow font-pixel animate-pixel-blink mt-2 text-[7px]">
              FIRING...
            </p>
          )}
        </div>

        {error && (
          <div className="border-arcade-red bg-arcade-red/10 mb-4 border-4 p-3 text-center">
            <p className="text-arcade-red font-pixel text-[7px]">{error}</p>
          </div>
        )}

        {/* Grids */}
        <div className="flex flex-col items-center justify-center gap-8 lg:flex-row lg:items-start lg:gap-12">
          {/* My board (defense) */}
          <GameGrid
            gridSize={game.gridSize}
            ships={myBoard?.shipCoordinates ?? []}
            hits={myBoardHits}
            misses={myBoardMisses}
            label="YOUR WATERS"
          />

          {/* Divider */}
          <div className="text-arcade-muted font-pixel hidden text-lg lg:flex lg:items-center lg:self-center">
            VS
          </div>

          {/* Attack board */}
          <GameGrid
            gridSize={game.gridSize}
            hits={attackHits}
            misses={attackMisses}
            interactive={!!isMyTurn && !sending && !!opponentReady}
            onCellClick={handleAttack}
            label="ENEMY WATERS"
          />
        </div>

        {/* Stats */}
        <div className="mt-8 flex justify-center gap-8">
          <div className="border-arcade-border border-4 px-4 py-2 text-center">
            <p className="text-arcade-muted font-pixel text-[6px]">HITS DEALT</p>
            <p className="text-arcade-red font-pixel text-sm">{attackHits.length}</p>
          </div>
          <div className="border-arcade-border border-4 px-4 py-2 text-center">
            <p className="text-arcade-muted font-pixel text-[6px]">HITS TAKEN</p>
            <p className="text-arcade-yellow font-pixel text-sm">{myBoardHits.length}</p>
          </div>
          <div className="border-arcade-border border-4 px-4 py-2 text-center">
            <p className="text-arcade-muted font-pixel text-[6px]">MOVES</p>
            <p className="text-arcade-cyan font-pixel text-sm">{totalMoves}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── FINISHED (Completed, needs revealWinner call) ──
  if (phase === 'finished' && game) {
    const iWon = winner === myAddress;

    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8 text-center">
          {iWon ? (
            <>
              <h2 className="text-arcade-green font-pixel animate-pixel-bounce text-lg uppercase">
                VICTORY!
              </h2>
              <p className="text-arcade-green/80 font-pixel mt-2 text-[7px]">
                ALL ENEMY SHIPS DESTROYED
              </p>
            </>
          ) : isPlayer ? (
            <>
              <h2 className="text-arcade-red font-pixel animate-pixel-shake text-lg uppercase">
                DEFEAT
              </h2>
              <p className="text-arcade-red/80 font-pixel mt-2 text-[7px]">
                YOUR FLEET HAS BEEN SUNK
              </p>
            </>
          ) : (
            <h2 className="text-arcade-yellow font-pixel text-sm uppercase">GAME OVER</h2>
          )}

          {winner && (
            <p className="text-arcade-muted font-pixel mt-4 text-[7px]">
              WINNER: {truncateAddress(winner)}
            </p>
          )}
        </div>

        {/* Reveal Winner button — commits boards back to base layer */}
        {isPlayer && (
          <div className="mb-8 text-center">
            <button
              onClick={handleRevealWinner}
              disabled={revealing}
              className="border-arcade-yellow bg-arcade-yellow/10 text-arcade-yellow hover:bg-arcade-yellow hover:text-arcade-bg font-pixel border-4 px-8 py-3 text-[8px] uppercase transition-none active:scale-95 disabled:opacity-40"
            >
              {revealing ? 'REVEALING...' : '⚑ REVEAL & CLAIM REWARD'}
            </button>
            <p className="text-arcade-muted font-pixel mt-2 text-[6px]">
              COMMITS BOARDS TO CHAIN & CLAIMS WAGER
            </p>
          </div>
        )}

        {error && (
          <div className="border-arcade-red bg-arcade-red/10 mb-4 border-4 p-3 text-center">
            <p className="text-arcade-red font-pixel text-[7px]">{error}</p>
          </div>
        )}

        {/* Wager info */}
        {game.wager > 0n && (
          <div className="mb-6 text-center">
            <p className="text-arcade-muted font-pixel text-[7px]">
              WAGER:{' '}
              <span className="text-arcade-yellow">{formatSol(game.wager)} SOL</span>
            </p>
          </div>
        )}

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/battleship')}
            className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg font-pixel border-4 px-8 py-3 text-[8px] uppercase transition-none active:scale-95"
          >
            BACK TO LOBBY
          </button>
        </div>
      </div>
    );
  }

  // ── REVEALED (winner claimed, boards undelegated) ──
  if (phase === 'revealed' && game) {
    const iWon = winner === myAddress;

    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8 text-center">
          {iWon ? (
            <h2 className="text-arcade-green font-pixel animate-pixel-bounce text-lg uppercase">
              VICTORY!
            </h2>
          ) : isPlayer ? (
            <h2 className="text-arcade-red font-pixel text-lg uppercase">DEFEAT</h2>
          ) : (
            <h2 className="text-arcade-yellow font-pixel text-sm uppercase">GAME OVER</h2>
          )}

          {winner && (
            <p className="text-arcade-muted font-pixel mt-4 text-[7px]">
              WINNER: {truncateAddress(winner)}
            </p>
          )}
        </div>

        {/* Revealed boards — revealedShipsPlayer1 = ships P1 sunk (P2's ships),
            revealedShipsPlayer2 = ships P2 sunk (P1's ships) */}
        <div className="flex flex-col items-center justify-center gap-8 lg:flex-row lg:items-start lg:gap-12">
          {/* Player 1 board — their ships are revealed in revealedShipsPlayer2 */}
          <div>
            <GameGrid
              gridSize={game.gridSize}
              revealedShips={game.revealedShipsPlayer2}
              hits={myBoardHits}
              label={`P1 ${isPlayer1 ? '(YOU)' : truncateAddress(game.player1)}`}
            />
          </div>

          <div className="text-arcade-muted font-pixel hidden text-lg lg:flex lg:items-center lg:self-center">
            VS
          </div>

          {/* Player 2 board — their ships are revealed in revealedShipsPlayer1 */}
          <div>
            <GameGrid
              gridSize={game.gridSize}
              revealedShips={game.revealedShipsPlayer1}
              hits={attackHits}
              label={`P2 ${isPlayer2 ? '(YOU)' : isSome(game.player2) ? truncateAddress(game.player2.value) : ''}`}
            />
          </div>
        </div>

        {/* Wager info */}
        {game.wager > 0n && (
          <div className="mt-8 text-center">
            <p className="text-arcade-muted font-pixel text-[7px]">
              WAGER:{' '}
              <span className="text-arcade-yellow">{formatSol(game.wager)} SOL</span>
            </p>
          </div>
        )}

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/battleship')}
            className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg font-pixel border-4 px-8 py-3 text-[8px] uppercase transition-none active:scale-95"
          >
            BACK TO LOBBY
          </button>
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-arcade-cyan font-pixel animate-pixel-blink text-[10px]">
        LOADING...
      </p>
    </div>
  );
}
