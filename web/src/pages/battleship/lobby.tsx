import { useCallback, useContext, useState } from 'react';

import {
  getCreateGameInstruction,
  getJoinGameInstruction,
  type Game,
} from '@client/cayed';
import { type KeyPairSigner, type MaybeAccount } from '@solana/kit';
import { useWalletAccountTransactionSendingSigner } from '@solana/react';
import { type UiWalletAccount } from '@wallet-standard/react';
import { useNavigate } from 'react-router';
import { getPDAAndBump } from 'solana-kite';

import { ChainContext } from '@/context/chain-context';
import { ConnectionContext } from '@/context/connection-context';
import { SelectedWalletAccountContext } from '@/context/selected-wallet-account-context';
import { useGames } from '@/hooks/use-games';
import { CAYED_PROGRAM_ADDRESS, LAMPORTS_PER_SOL } from '@/lib/constants';

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

  const openGames = games.filter(
    (g): g is MaybeAccount<Game> & { exists: true } =>
      'exists' in g && g.exists && g.data.status.__kind === 'AwaitingPlayerTwo'
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <LobbyHeader onBack={() => navigate('/')} />

      <div className="border-arcade-border bg-arcade-panel mb-8 border p-6 text-center">
        <p className="text-arcade-muted font-mono text-sm">
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
  const { connection } = useContext(ConnectionContext);
  const { chain } = useContext(ChainContext);
  const signer = useWalletAccountTransactionSendingSigner(account, chain);
  const { games, loading, refetch } = useGames();

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState(6);
  const [wager, setWager] = useState('0.001');

  const openGames = games.filter(
    (g): g is MaybeAccount<Game> & { exists: true } =>
      'exists' in g && g.exists && g.data.status.__kind === 'AwaitingPlayerTwo'
  );

  const handleCreateGame = useCallback(async () => {
    setCreating(true);
    try {
      const gameId = BigInt(Date.now());
      const wagerLamports = BigInt(Math.floor(parseFloat(wager) * LAMPORTS_PER_SOL));

      const { pda: configPda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, ['config']);
      const { pda: vaultPda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, ['vault']);
      const { pda: gamePda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, [
        'game',
        gameId,
      ]);
      const { pda: playerBoardPda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, [
        'player',
        gameId,
        account.address,
      ]);

      const ix = getCreateGameInstruction({
        player: signer as unknown as KeyPairSigner,
        game: gamePda,
        playerBoard: playerBoardPda,
        config: configPda,
        vault: vaultPda,
        id: gameId,
        gridSize,
        wager: wagerLamports,
      });

      await connection.sendTransactionFromInstructionsWithWalletApp({
        feePayer: signer as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        instructions: [ix],
      });

      navigate(`/battleship/${gameId.toString()}`);
    } catch (err) {
      console.error('Create game error:', err);
      alert(`Failed to create game: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  }, [signer, account.address, gridSize, wager, connection, navigate]);

  const handleJoinGame = useCallback(
    async (game: Game) => {
      const gameIdStr = game.id.toString();
      setJoining(gameIdStr);
      try {
        const { pda: gamePda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, [
          'game',
          game.id,
        ]);
        const { pda: vaultPda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, ['vault']);
        const { pda: playerBoardPda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, [
          'player',
          game.id,
          account.address,
        ]);

        const ix = getJoinGameInstruction({
          player: signer as unknown as KeyPairSigner,
          game: gamePda,
          playerBoard: playerBoardPda,
          vault: vaultPda,
        });

        await connection.sendTransactionFromInstructionsWithWalletApp({
          feePayer: signer as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          instructions: [ix],
        });

        navigate(`/battleship/${gameIdStr}`);
      } catch (err) {
        console.error('Join game error:', err);
        alert(`Failed to join game: ${(err as Error).message}`);
      } finally {
        setJoining(null);
      }
    },
    [signer, account.address, connection, navigate]
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <LobbyHeader onBack={() => navigate('/')} />

        <button
          onClick={() => setShowCreate(s => !s)}
          className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg border-2 px-5 py-2 font-mono text-sm tracking-widest uppercase transition-all duration-100 active:scale-95"
        >
          {showCreate ? 'CANCEL' : 'CREATE GAME'}
        </button>
      </div>

      {/* Create game form */}
      {showCreate && (
        <div className="border-arcade-cyan/30 bg-arcade-panel mb-8 border-2 p-6">
          <h2 className="text-arcade-cyan mb-6 font-mono text-sm tracking-widest uppercase">
            NEW GAME
          </h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <span className="text-arcade-muted mb-2 block font-mono text-xs tracking-wider uppercase">
                GRID SIZE
              </span>
              <div className="flex gap-2">
                {[4, 5, 6, 7, 8, 10].map(size => (
                  <button
                    key={size}
                    onClick={() => setGridSize(size)}
                    className={`border px-3 py-2 font-mono text-sm transition-all duration-100 ${
                      gridSize === size
                        ? 'border-arcade-cyan bg-arcade-cyan/20 text-arcade-cyan'
                        : 'border-arcade-border text-arcade-muted hover:border-arcade-cyan/50 hover:text-arcade-text'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="wager-input"
                className="text-arcade-muted mb-2 block font-mono text-xs tracking-wider uppercase"
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
                className="border-arcade-border bg-arcade-bg text-arcade-text focus:border-arcade-cyan w-full border px-4 py-2 font-mono text-sm transition-colors outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleCreateGame}
            disabled={creating}
            className="border-arcade-green bg-arcade-green/10 text-arcade-green hover:bg-arcade-green hover:text-arcade-bg mt-6 w-full border-2 px-6 py-3 font-mono text-sm tracking-widest uppercase transition-all duration-100 active:scale-[0.98] disabled:opacity-40"
          >
            {creating ? 'DEPLOYING...' : 'DEPLOY FLEET'}
          </button>
        </div>
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
    <div>
      <button
        onClick={onBack}
        className="text-arcade-muted hover:text-arcade-cyan mb-2 font-mono text-xs tracking-wider uppercase transition-colors"
      >
        ← BACK
      </button>
      <h1
        className="text-arcade-text font-mono text-2xl font-bold tracking-widest uppercase"
        style={{ textShadow: '0 0 10px rgb(224 224 224 / 0.1)' }}
      >
        ⚓ BATTLESHIP
      </h1>
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
        <h2 className="text-arcade-muted font-mono text-sm tracking-widest uppercase">
          OPEN GAMES
        </h2>
        <button
          onClick={onRefresh}
          className="text-arcade-muted hover:text-arcade-cyan font-mono text-xs tracking-wider uppercase transition-colors"
        >
          REFRESH
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <p className="text-arcade-muted font-mono text-sm">
            SCANNING CHAIN
            <span className="inline-block animate-pulse">...</span>
          </p>
        </div>
      ) : games.length === 0 ? (
        <div className="border-arcade-border bg-arcade-panel border p-8 text-center">
          <p className="text-arcade-muted font-mono text-sm">NO OPEN GAMES FOUND</p>
          <p className="text-arcade-border mt-2 font-mono text-xs">
            CREATE ONE TO GET STARTED
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {games.map(g => {
            const game = g.data;
            const isOwnGame = account?.address === game.player1;

            return (
              <div
                key={g.address}
                className="border-arcade-border bg-arcade-panel hover:border-arcade-cyan/30 flex items-center justify-between border p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-4">
                    <span className="text-arcade-muted font-mono text-xs">
                      {game.player1.slice(0, 4)}..{game.player1.slice(-4)}
                    </span>
                    <span className="text-arcade-cyan font-mono text-xs">
                      {game.gridSize}×{game.gridSize}
                    </span>
                    <span className="text-arcade-yellow font-mono text-xs">
                      {(Number(game.wager) / LAMPORTS_PER_SOL).toFixed(3)} SOL
                    </span>
                  </div>
                </div>

                {onJoin && account && !isOwnGame ? (
                  <button
                    onClick={() => onJoin(game)}
                    disabled={joining === game.id.toString()}
                    className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg ml-4 border px-4 py-1.5 font-mono text-xs tracking-widest uppercase transition-all duration-100 active:scale-95 disabled:opacity-40"
                  >
                    {joining === game.id.toString() ? 'JOINING...' : 'JOIN'}
                  </button>
                ) : isOwnGame && onResume ? (
                  <button
                    onClick={() => onResume(game)}
                    className="border-arcade-yellow text-arcade-yellow hover:bg-arcade-yellow hover:text-arcade-bg ml-4 border px-4 py-1.5 font-mono text-xs tracking-widest uppercase transition-all duration-100"
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
