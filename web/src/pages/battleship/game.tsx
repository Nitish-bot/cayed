import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchMaybeGame,
  fetchMaybePlayerBoard,
  getHideShipsInstruction,
  getMakeMoveInstruction,
  type Game,
  type PlayerBoard,
  type ShipCoordinatesArgs,
} from '@client/cayed';
import { isSome, type Address, type KeyPairSigner } from '@solana/kit';
import { useWalletAccountTransactionSendingSigner } from '@solana/react';
import { type UiWalletAccount } from '@wallet-standard/react';
import { useNavigate, useParams } from 'react-router';
import { getPDAAndBump } from 'solana-kite';

import { GameGrid } from '@/components/battleship/game-grid';
import { ChainContext } from '@/context/chain-context';
import { ConnectionContext } from '@/context/connection-context';
import { SelectedWalletAccountContext } from '@/context/selected-wallet-account-context';
import { CAYED_PROGRAM_ADDRESS, getShipSizes } from '@/lib/constants';
import {
  buildShip,
  cellKey,
  getShipCells,
  validateShipPlacement,
  type CellCoord,
} from '@/lib/ships';

type GamePhase = 'loading' | 'waiting' | 'placement' | 'battle' | 'finished';

const POLL_MS = 3000;

export function BattleshipGame() {
  const { gameId: gameIdStr } = useParams<{ gameId: string }>();
  const [selectedWalletAccount] = useContext(SelectedWalletAccountContext);

  if (!selectedWalletAccount) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-arcade-muted font-mono text-sm tracking-wider uppercase">
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
  const { connection } = useContext(ConnectionContext);
  const { chain } = useContext(ChainContext);
  const signer = useWalletAccountTransactionSendingSigner(account, chain);

  const gameId = useMemo(() => BigInt(gameIdStr ?? '0'), [gameIdStr]);

  // ── State ──
  const [game, setGame] = useState<Game | null>(null);
  const [myBoard, setMyBoard] = useState<PlayerBoard | null>(null);
  const [opponentBoard, setOpponentBoard] = useState<PlayerBoard | null>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Ship placement state
  const [placedShips, setPlacedShips] = useState<ShipCoordinatesArgs[]>([]);
  const [currentShipIdx, setCurrentShipIdx] = useState(0);
  const [orientation, setOrientation] = useState<'h' | 'v'>('h');
  const [hoveredCell, setHoveredCell] = useState<CellCoord | null>(null);

  // Attack tracking (local)
  const [myAttacks, setMyAttacks] = useState<Map<string, 'hit' | 'miss'>>(new Map());

  // ── Derived ──
  const myAddress = account.address;
  const isPlayer1 = game?.player1 === myAddress;
  const isPlayer2 = game && isSome(game.player2) && game.player2.value === myAddress;
  const isPlayer = isPlayer1 || isPlayer2;
  const opponentAddress = isPlayer1
    ? game && isSome(game.player2)
      ? game.player2.value
      : null
    : (game?.player1 ?? null);
  const isMyTurn =
    game && ((isPlayer1 && game.nextMovePlayer1) || (isPlayer2 && !game.nextMovePlayer1));

  const shipSizes = useMemo(() => (game ? getShipSizes(game.gridSize) : []), [game]);

  // ── PDA derivation ──
  const pdaRef = useRef<{
    gamePda: Address | null;
    myBoardPda: Address | null;
    opponentBoardPda: Address | null;
  }>({ gamePda: null, myBoardPda: null, opponentBoardPda: null });

  useEffect(() => {
    let cancelled = false;
    async function derive() {
      const { pda: gamePda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, [
        'game',
        gameId,
      ]);
      pdaRef.current.gamePda = gamePda;

      if (myAddress) {
        const { pda: myBoardPda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, [
          'player',
          gameId,
          myAddress,
        ]);
        if (!cancelled) pdaRef.current.myBoardPda = myBoardPda;
      }
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
      const { pda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, [
        'player',
        gameId,
        opponentAddress!,
      ]);
      if (!cancelled) pdaRef.current.opponentBoardPda = pda;
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
      const maybeGame = await fetchMaybeGame(connection.rpc, pdaRef.current.gamePda);
      if (!maybeGame.exists) {
        setError('Game not found');
        return;
      }
      setGame(maybeGame.data);

      // Fetch my board
      if (pdaRef.current.myBoardPda) {
        try {
          const maybeBoard = await fetchMaybePlayerBoard(
            connection.rpc,
            pdaRef.current.myBoardPda
          );
          if (maybeBoard.exists) setMyBoard(maybeBoard.data);
        } catch {
          /* board may not exist yet */
        }
      }

      // Fetch opponent board (base layer only — no privacy)
      if (pdaRef.current.opponentBoardPda) {
        try {
          const maybeBoard = await fetchMaybePlayerBoard(
            connection.rpc,
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
  }, [connection]);

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

    if (status === 'Completed' || status === 'AwaitingWinnerReveal') {
      setPhase('finished');
      return;
    }

    if (status === 'AwaitingPlayerTwo') {
      setPhase('waiting');
      return;
    }

    if (status === 'InProgress') {
      // Check if I've placed ships
      if (isPlayer && myBoard && myBoard.shipCoordinates.length === 0) {
        setPhase('placement');
        return;
      }
      setPhase('battle');
      return;
    }

    setPhase('loading');
  }, [game, myBoard, isPlayer]);

  // ── Sync attack map from opponent board ──
  useEffect(() => {
    if (!opponentBoard) return;
    setMyAttacks(prev => {
      const newAttacks = new Map(prev);
      for (const hit of opponentBoard.hitsReceived) {
        const key = cellKey(hit.x, hit.y);
        newAttacks.set(key, 'hit');
      }
      return newAttacks;
    });
  }, [opponentBoard]);

  // ── Ship placement preview ──
  const previewShip = useMemo(() => {
    if (phase !== 'placement' || !hoveredCell || currentShipIdx >= shipSizes.length)
      return null;
    const size = shipSizes[currentShipIdx];
    const ship = buildShip(hoveredCell.x, hoveredCell.y, size, orientation);
    const valid = validateShipPlacement(ship, game?.gridSize ?? 0, placedShips);
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
      const ix = getHideShipsInstruction({
        player: signer as unknown as KeyPairSigner,
        game: pdaRef.current.gamePda,
        playerBoard: pdaRef.current.myBoardPda,
        ships: placedShips,
      });

      await connection.sendTransactionFromInstructionsWithWalletApp({
        feePayer: signer as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        instructions: [ix],
      });

      // Refresh state
      await fetchState();
    } catch (err) {
      console.error('Hide ships error:', err);
      setError(`Failed to deploy fleet: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }, [signer, placedShips, connection, fetchState]);

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
      if (myAttacks.has(key)) return; // Already attacked

      setSending(true);
      try {
        const ix = getMakeMoveInstruction({
          player: signer as unknown as KeyPairSigner,
          opponent: opponentAddress,
          game: pdaRef.current.gamePda,
          playerBoard: pdaRef.current.myBoardPda,
          opponentBoard: pdaRef.current.opponentBoardPda,
          x: coord.x,
          y: coord.y,
        });

        await connection.sendTransactionFromInstructionsWithWalletApp({
          feePayer: signer as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          instructions: [ix],
        });

        // Refresh to get hit/miss result
        await fetchState();

        // Determine hit or miss from updated opponent board
        const updated = new Map(myAttacks);
        // Check if the coordinate is now in opponent's hits_received
        if (opponentBoard?.hitsReceived.some(h => h.x === coord.x && h.y === coord.y)) {
          updated.set(key, 'hit');
        } else {
          updated.set(key, 'miss');
        }
        setMyAttacks(updated);
      } catch (err) {
        console.error('Attack error:', err);
        setError(`Attack failed: ${(err as Error).message}`);
      } finally {
        setSending(false);
      }
    },
    [
      signer,
      isMyTurn,
      sending,
      opponentAddress,
      myAttacks,
      opponentBoard,
      connection,
      fetchState,
    ]
  );

  // ── Render helpers ──
  const myBoardHits: CellCoord[] = useMemo(
    () => myBoard?.hitsReceived.map(h => ({ x: h.x, y: h.y })) ?? [],
    [myBoard]
  );

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
      ? (game.status as { __kind: 'Completed'; winner: Address }).winner
      : null;

  // ═══════════════════════════════════════
  // ── RENDER ──
  // ═══════════════════════════════════════

  if (error && !game) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-arcade-red font-mono text-lg">{error}</p>
          <button
            onClick={() => navigate('/battleship')}
            className="text-arcade-cyan mt-4 font-mono text-sm hover:underline"
          >
            ← BACK TO LOBBY
          </button>
        </div>
      </div>
    );
  }

  // ── LOADING ──
  if (phase === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-arcade-muted font-mono text-sm tracking-widest uppercase">
            LOADING GAME
            <span className="inline-block animate-pulse">...</span>
          </p>
        </div>
      </div>
    );
  }

  // ── WAITING FOR OPPONENT ──
  if (phase === 'waiting') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-arcade-muted mb-2 font-mono text-xs tracking-wider uppercase">
          GAME #{gameIdStr}
        </p>
        <h2 className="text-arcade-text mb-8 font-mono text-xl tracking-widest uppercase">
          AWAITING OPPONENT
        </h2>
        <div className="border-arcade-border bg-arcade-panel mb-8 border p-6">
          <p className="text-arcade-muted font-mono text-sm">
            GRID:{' '}
            <span className="text-arcade-cyan">
              {game?.gridSize}×{game?.gridSize}
            </span>
          </p>
          <p className="text-arcade-muted mt-2 font-mono text-sm">
            WAGER:{' '}
            <span className="text-arcade-yellow">
              {game ? (Number(game.wager) / 1e9).toFixed(3) : '0'} SOL
            </span>
          </p>
        </div>
        <p className="text-arcade-muted animate-pulse font-mono text-xs">
          SHARE THIS GAME TO FIND AN OPPONENT
        </p>
        <button
          onClick={() => navigate('/battleship')}
          className="text-arcade-muted hover:text-arcade-cyan mt-8 font-mono text-sm"
        >
          ← BACK TO LOBBY
        </button>
      </div>
    );
  }

  // ── SHIP PLACEMENT ──
  if (phase === 'placement' && game) {
    const allPlaced = currentShipIdx >= shipSizes.length;

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h2
          className="text-arcade-text mb-6 text-center font-mono text-xl tracking-widest uppercase"
          style={{ textShadow: '0 0 10px rgb(224 224 224 / 0.1)' }}
        >
          DEPLOY YOUR FLEET
        </h2>

        {/* Ship list */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
          {shipSizes.map((size, idx) => (
            <div
              key={idx}
              className={`border px-3 py-1.5 font-mono text-xs uppercase ${
                idx < currentShipIdx
                  ? 'border-arcade-green/40 text-arcade-green'
                  : idx === currentShipIdx
                    ? 'border-arcade-cyan text-arcade-cyan'
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
              className="border-arcade-border text-arcade-muted hover:border-arcade-cyan hover:text-arcade-cyan border px-3 py-1 font-mono text-xs transition-colors"
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
              className="border-arcade-border text-arcade-muted hover:border-arcade-red hover:text-arcade-red border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              UNDO
            </button>
          )}

          {allPlaced && (
            <button
              onClick={handleDeployFleet}
              disabled={sending}
              className="border-arcade-green bg-arcade-green/10 text-arcade-green hover:bg-arcade-green hover:text-arcade-bg border-2 px-8 py-3 font-mono text-sm tracking-widest uppercase transition-all duration-100 active:scale-95 disabled:opacity-40"
            >
              {sending ? 'DEPLOYING...' : 'DEPLOY FLEET'}
            </button>
          )}
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
            <p className="text-arcade-yellow animate-pulse font-mono text-sm tracking-widest uppercase">
              WAITING FOR OPPONENT TO DEPLOY FLEET...
            </p>
          ) : isMyTurn ? (
            <p
              className="text-arcade-cyan font-mono text-lg tracking-widest uppercase"
              style={{ textShadow: '0 0 15px rgb(0 255 204 / 0.4)' }}
            >
              YOUR TURN — FIRE!
            </p>
          ) : (
            <p className="text-arcade-muted animate-pulse font-mono text-sm tracking-widest uppercase">
              OPPONENT IS AIMING...
            </p>
          )}
          {sending && (
            <p className="text-arcade-yellow mt-2 font-mono text-xs">FIRING...</p>
          )}
        </div>

        {error && (
          <div className="border-arcade-red/40 bg-arcade-red/10 mb-4 border p-3 text-center">
            <p className="text-arcade-red font-mono text-xs">{error}</p>
          </div>
        )}

        {/* Grids */}
        <div className="flex flex-col items-center justify-center gap-8 lg:flex-row lg:items-start lg:gap-12">
          {/* My board (defense) */}
          <GameGrid
            gridSize={game.gridSize}
            ships={myBoard?.shipCoordinates ?? []}
            hits={myBoardHits}
            label="YOUR WATERS"
          />

          {/* Divider */}
          <div className="bg-arcade-border hidden h-px w-24 self-center lg:block lg:h-auto lg:w-px lg:self-stretch" />

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
          <div className="text-center">
            <p className="text-arcade-muted font-mono text-xs">HITS DEALT</p>
            <p className="text-arcade-red font-mono text-lg">{attackHits.length}</p>
          </div>
          <div className="text-center">
            <p className="text-arcade-muted font-mono text-xs">HITS TAKEN</p>
            <p className="text-arcade-yellow font-mono text-lg">{myBoardHits.length}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── FINISHED ──
  if (phase === 'finished' && game) {
    const iWon = winner === myAddress;
    const isDraw = !winner;

    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Winner announcement */}
        <div className="mb-8 text-center">
          {isDraw ? (
            <h2 className="text-arcade-yellow font-mono text-2xl tracking-widest uppercase">
              GAME OVER
            </h2>
          ) : iWon ? (
            <>
              <h2
                className="text-arcade-green font-mono text-3xl tracking-widest uppercase"
                style={{ textShadow: '0 0 20px rgb(0 204 102 / 0.4)' }}
              >
                VICTORY
              </h2>
              <p className="text-arcade-green/80 mt-2 font-mono text-sm">
                ALL ENEMY SHIPS DESTROYED
              </p>
            </>
          ) : isPlayer ? (
            <>
              <h2
                className="text-arcade-red font-mono text-3xl tracking-widest uppercase"
                style={{ textShadow: '0 0 20px rgb(255 51 51 / 0.4)' }}
              >
                DEFEAT
              </h2>
              <p className="text-arcade-red/80 mt-2 font-mono text-sm">
                YOUR FLEET HAS BEEN SUNK
              </p>
            </>
          ) : (
            <h2 className="text-arcade-text font-mono text-2xl tracking-widest uppercase">
              GAME OVER
            </h2>
          )}

          {winner && (
            <p className="text-arcade-muted mt-4 font-mono text-xs">
              WINNER: {winner.slice(0, 8)}...{winner.slice(-8)}
            </p>
          )}
        </div>

        {/* Revealed boards */}
        <div className="flex flex-col items-center justify-center gap-8 lg:flex-row lg:items-start lg:gap-12">
          {/* Player 1 board */}
          <div>
            <GameGrid
              gridSize={game.gridSize}
              ships={game.revealedShipsPlayer1}
              hits={
                opponentBoard && isPlayer1
                  ? myBoardHits
                  : myBoard
                    ? myBoard.hitsReceived.map(h => ({ x: h.x, y: h.y }))
                    : []
              }
              revealedShips={game.revealedShipsPlayer1}
              label={`PLAYER 1 ${isPlayer1 ? '(YOU)' : ''}`}
            />
          </div>

          <div className="bg-arcade-border hidden h-px w-24 self-center lg:block lg:h-auto lg:w-px lg:self-stretch" />

          {/* Player 2 board */}
          <div>
            <GameGrid
              gridSize={game.gridSize}
              ships={game.revealedShipsPlayer2}
              hits={
                opponentBoard && isPlayer2
                  ? myBoardHits
                  : opponentBoard
                    ? opponentBoard.hitsReceived.map(h => ({
                        x: h.x,
                        y: h.y,
                      }))
                    : []
              }
              revealedShips={game.revealedShipsPlayer2}
              label={`PLAYER 2 ${isPlayer2 ? '(YOU)' : ''}`}
            />
          </div>
        </div>

        {/* Wager info */}
        {game.wager > 0n && (
          <div className="mt-8 text-center">
            <p className="text-arcade-muted font-mono text-xs">
              WAGER:{' '}
              <span className="text-arcade-yellow">
                {(Number(game.wager) / 1e9).toFixed(3)} SOL
              </span>
            </p>
          </div>
        )}

        {/* Back button */}
        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/battleship')}
            className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg border-2 px-8 py-3 font-mono text-sm tracking-widest uppercase transition-all duration-100 active:scale-95"
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
      <p className="text-arcade-muted font-mono text-sm">
        LOADING<span className="animate-pulse">...</span>
      </p>
    </div>
  );
}
