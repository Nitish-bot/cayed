import { useCallback, useContext, useEffect, useState } from 'react';

import { type Game } from '@client/cayed';
import { isSome, type MaybeAccount } from '@solana/kit';
import { useWalletAccountTransactionSigner } from '@solana/react';
import { type UiWalletAccount } from '@wallet-standard/react';
import { useNavigate } from 'react-router';

import { ChainContext } from '@/context/chain-context';
import { useGameService } from '@/context/game-service-provider';
import { SelectedWalletAccountContext } from '@/context/selected-wallet-account-context';
import { useGames } from '@/hooks/use-games';
import {
  formatSol,
  gridDisplay,
  LAMPORTS_PER_SOL,
  MIN_WAGER_LAMPORTS,
  truncateAddress,
} from '@/lib/constants';

const LOBBY_POLL_MS = 10_000;

/* ═══════════════════════════════════════
   Guard: split connected / disconnected
   ═══════════════════════════════════════ */

export function BattleshipLobby() {
  const [selectedWalletAccount] = useContext(SelectedWalletAccountContext);

  if (!selectedWalletAccount) {
    return <LobbyDisconnected />;
  }
  return <LobbyConnected account={selectedWalletAccount} />;
}

/* ── Disconnected view (browse-only) ── */

function LobbyDisconnected() {
  const navigate = useNavigate();
  const { games, loading, refetch } = useGames();

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(() => void refetch(), LOBBY_POLL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  const openGames = games.filter(
    (g): g is MaybeAccount<Game> & { exists: true } =>
      'exists' in g && g.exists && g.data.status.__kind === 'AwaitingPlayerTwo'
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <LobbyHeader onBack={() => navigate('/')} />

      <div className="border-arcade-border bg-arcade-panel mb-8 border-4 p-6 text-center">
        <p className="text-arcade-muted font-pixel text-[8px]">
          CONNECT WALLET TO CREATE OR JOIN GAMES
        </p>
      </div>

      <GameList games={openGames} loading={loading} onRefresh={refetch} />
    </div>
  );
}

/* ── Connected view (full interaction) ── */

function LobbyConnected({ account }: { account: UiWalletAccount }) {
  const navigate = useNavigate();
  const { chain } = useContext(ChainContext);
  const signer = useWalletAccountTransactionSigner(account, chain);
  const { games, loading, refetch } = useGames();

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState(6);
  const [wager, setWager] = useState('0.001');

  const gameService = useGameService();

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(() => void refetch(), LOBBY_POLL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  // Auto-dismiss errors
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  const openGames = games.filter(
    (g): g is MaybeAccount<Game> & { exists: true } =>
      'exists' in g && g.exists && g.data.status.__kind === 'AwaitingPlayerTwo'
  );

  // My active games (any status, where I'm a player)
  const myGames = games.filter(
    (g): g is MaybeAccount<Game> & { exists: true } =>
      'exists' in g &&
      g.exists &&
      (g.data.player1 === account.address ||
        (isSome(g.data.player2) && g.data.player2.value === account.address)) &&
      g.data.status.__kind !== 'AwaitingPlayerTwo'
  );

  const handleCreateGame = useCallback(async () => {
    // Validate wager
    const wagerLamports = BigInt(Math.floor(parseFloat(wager) * LAMPORTS_PER_SOL));
    if (wagerLamports > 0n && wagerLamports < BigInt(MIN_WAGER_LAMPORTS)) {
      setError(`Minimum wager is ${MIN_WAGER_LAMPORTS / LAMPORTS_PER_SOL} SOL`);
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const gameId = BigInt(Date.now());

      // FIX: Await the createGame call
      await gameService.createGame({
        player: signer,
        gameId,
        gridSize,
        wager: wagerLamports,
      });

      navigate(`/battleship/${gameId.toString()}`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error('Create game error:', err);
      if (/reject|denied|cancelled/i.test(msg)) {
        setError(
          'Wallet rejected the request. Brave browser may auto-reject devnet transactions — try Phantom, Backpack, or Solflare instead.'
        );
      } else {
        setError(`Failed to create game: ${msg}`);
      }
    } finally {
      setCreating(false);
    }
  }, [signer, gridSize, wager, gameService, navigate]);

  const handleJoinGame = useCallback(
    async (game: Game) => {
      const gameIdStr = game.id.toString();
      setJoining(gameIdStr);
      setError(null);
      try {
        await gameService.joinGame({
          player: signer,
          gameId: game.id,
        });

        navigate(`/battleship/${gameIdStr}`);
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        console.error('Join game error:', err);
        if (/reject|denied|cancelled/i.test(msg)) {
          setError(
            'Wallet rejected the request. Brave Wallet may auto-reject devnet transactions — try Phantom, Backpack, or Solflare instead.'
          );
        } else {
          setError(`Failed to join game: ${msg}`);
        }
      } finally {
        setJoining(null);
      }
    },
    [signer, gameService, navigate]
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <LobbyHeader onBack={() => navigate('/')} />

        <button
          onClick={() => setShowCreate(s => !s)}
          className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg font-pixel border-4 px-5 py-2 text-[8px] uppercase transition-none active:scale-95"
        >
          {showCreate ? 'CANCEL' : '+ NEW GAME'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-arcade-red bg-arcade-red/10 mb-6 border-4 p-3 text-center">
          <p className="text-arcade-red font-pixel text-[7px]">{error}</p>
        </div>
      )}

      {/* Create game form */}
      {showCreate && (
        <div className="border-arcade-cyan bg-arcade-panel mb-8 border-4 p-6">
          <h2 className="text-arcade-cyan font-pixel mb-6 text-[9px] uppercase">
            NEW GAME
          </h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <span className="text-arcade-muted font-pixel mb-2 block text-[7px] uppercase">
                GRID SIZE
              </span>
              <div className="flex gap-2">
                {[4, 6, 8, 10].map(size => (
                  <button
                    key={size}
                    onClick={() => setGridSize(size)}
                    className={`font-pixel border-4 px-3 py-2 text-[8px] transition-none ${
                      gridSize === size
                        ? 'border-arcade-cyan bg-arcade-cyan/20 text-arcade-cyan'
                        : 'border-arcade-border text-arcade-muted hover:border-arcade-cyan hover:text-arcade-text'
                    }`}
                  >
                    {gridDisplay(size)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="wager-input"
                className="text-arcade-muted font-pixel mb-2 block text-[7px] uppercase"
              >
                WAGER (SOL)
              </label>
              <input
                id="wager-input"
                type="number"
                step="0.001"
                min="0"
                value={wager}
                onChange={e => setWager(e.target.value)}
                className="border-arcade-border bg-arcade-bg text-arcade-text focus:border-arcade-cyan font-pixel w-full border-4 px-4 py-2 text-[8px] transition-none outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleCreateGame}
            disabled={creating}
            className="border-arcade-green bg-arcade-green/10 text-arcade-green hover:bg-arcade-green hover:text-arcade-bg font-pixel mt-6 w-full border-4 px-6 py-3 text-[8px] uppercase transition-none active:scale-[0.98] disabled:opacity-40"
          >
            {creating ? 'DEPLOYING...' : '⚓ DEPLOY FLEET'}
          </button>
        </div>
      )}

      {/* My active games */}
      {myGames.length > 0 && (
        <MyGamesList
          games={myGames}
          account={account}
          onResume={game => navigate(`/battleship/${game.id.toString()}`)}
        />
      )}

      <GameList
        games={openGames}
        loading={loading}
        onRefresh={refetch}
        account={account}
        joining={joining}
        onJoin={handleJoinGame}
        onResume={game => navigate(`/battleship/${game.id.toString()}`)}
      />
    </div>
  );
}

/* ═══════════════════════════════════════
   Shared sub-components
   ═══════════════════════════════════════ */

function LobbyHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="pb-4">
      <button
        onClick={onBack}
        className="text-arcade-muted hover:text-arcade-cyan font-pixel mb-2 text-[7px] uppercase transition-none"
      >
        &lt; BACK
      </button>
      <h1 className="text-arcade-cyan font-pixel text-sm uppercase">⚓ BATTLESHIP</h1>
    </div>
  );
}

function statusLabel(status: Game['status']): { text: string; color: string } {
  switch (status.__kind) {
    case 'AwaitingPlayerTwo':
      return { text: 'OPEN', color: 'text-arcade-green' };
    case 'HidingShips':
      return { text: 'SETUP', color: 'text-arcade-yellow' };
    case 'InProgress':
      return { text: 'BATTLE', color: 'text-arcade-red' };
    case 'Completed':
      return { text: 'ENDED', color: 'text-arcade-muted' };
    case 'WinnerRevealed':
      return { text: 'REVEALED', color: 'text-arcade-muted' };
    case 'Cancelled':
      return { text: 'CANCELLED', color: 'text-arcade-muted' };
    case 'Forfeited':
      return { text: 'FORFEIT', color: 'text-arcade-muted' };
    default:
      return { text: 'UNKNOWN', color: 'text-arcade-muted' };
  }
}

function MyGamesList({
  games,
  account,
  onResume,
}: {
  games: Array<MaybeAccount<Game> & { exists: true }>;
  account: UiWalletAccount;
  onResume: (game: Game) => void;
}) {
  return (
    <div className="mb-8">
      <h2 className="text-arcade-yellow font-pixel mb-4 text-[8px] uppercase">
        ► MY GAMES
      </h2>
      <div className="space-y-2">
        {games.map(g => {
          const game = g.data;
          const status = statusLabel(game.status);
          const isP1 = account.address === game.player1;
          const opAddr = isP1
            ? isSome(game.player2)
              ? truncateAddress(game.player2.value)
              : '???'
            : truncateAddress(game.player1);

          return (
            <button
              key={g.address}
              onClick={() => onResume(game)}
              className="border-arcade-border bg-arcade-panel hover:border-arcade-yellow flex w-full items-center justify-between border-4 p-3 text-left transition-none"
            >
              <div className="flex items-center gap-3">
                <span className={`font-pixel text-[6px] ${status.color}`}>
                  {status.text}
                </span>
                <span className="text-arcade-muted font-pixel text-[6px]">
                  VS {opAddr}
                </span>
                <span className="text-arcade-cyan font-pixel text-[6px]">
                  {gridDisplay(game.gridSize)}
                </span>
              </div>
              <span className="text-arcade-yellow font-pixel text-[6px]">
                {formatSol(game.wager)} SOL
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GameList({
  games,
  loading,
  onRefresh,
  account,
  joining,
  onJoin,
  onResume,
}: {
  games: Array<MaybeAccount<Game> & { exists: true }>;
  loading: boolean;
  onRefresh: () => void;
  account?: UiWalletAccount;
  joining?: string | null;
  onJoin?: (game: Game) => void;
  onResume?: (game: Game) => void;
}) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-arcade-muted font-pixel text-[8px] uppercase">OPEN GAMES</h2>
        <button
          onClick={onRefresh}
          className="text-arcade-muted hover:text-arcade-cyan font-pixel text-[7px] uppercase transition-none"
        >
          ↻ REFRESH
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <p className="text-arcade-cyan font-pixel animate-pixel-blink text-[8px]">
            SCANNING CHAIN...
          </p>
        </div>
      ) : games.length === 0 ? (
        <div className="border-arcade-border bg-arcade-panel border-4 p-8 text-center">
          <p className="text-arcade-muted font-pixel text-[8px]">NO OPEN GAMES FOUND</p>
          <p className="text-arcade-border font-pixel mt-3 text-[6px]">
            CREATE ONE TO GET STARTED
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {games.map(g => {
            const game = g.data;
            const isOwnGame = account?.address === game.player1;

            return (
              <div
                key={g.address}
                className="border-arcade-border bg-arcade-panel hover:border-arcade-cyan flex items-center justify-between border-4 p-4 transition-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-arcade-muted font-pixel text-[6px]">
                      {truncateAddress(game.player1)}
                    </span>
                    <span className="text-arcade-cyan font-pixel text-[6px]">
                      {gridDisplay(game.gridSize)}
                    </span>
                    <span className="text-arcade-yellow font-pixel text-[6px]">
                      {formatSol(game.wager)} SOL
                    </span>
                  </div>
                </div>

                {onJoin && account && !isOwnGame ? (
                  <button
                    onClick={() => onJoin(game)}
                    disabled={joining === game.id.toString()}
                    className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg font-pixel ml-4 border-4 px-4 py-1.5 text-[6px] uppercase transition-none active:scale-95 disabled:opacity-40"
                  >
                    {joining === game.id.toString() ? 'JOINING...' : 'JOIN'}
                  </button>
                ) : isOwnGame && onResume ? (
                  <button
                    onClick={() => onResume(game)}
                    className="border-arcade-yellow text-arcade-yellow hover:bg-arcade-yellow hover:text-arcade-bg font-pixel ml-4 border-4 px-4 py-1.5 text-[6px] uppercase transition-none"
                  >
                    RESUME
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
