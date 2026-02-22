import { useNavigate } from 'react-router';

const GAMES = [
  {
    id: 'battleship',
    name: 'BATTLESHIP',
    icon: '⚓',
    description: 'SINK OR BE SUNK',
    available: true,
    path: '/battleship',
  },
  {
    id: 'plinko',
    name: 'PLINKO',
    icon: '◉',
    description: 'DROP & WIN',
    available: false,
    path: '/plinko',
  },
];

export function Index() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[calc(100vh-60px)] flex-col items-center px-4 py-16">
      {/* Title */}
      <div className="mb-4 text-center">
        <h1
          className="text-arcade-cyan font-mono text-4xl font-bold tracking-[0.4em] uppercase sm:text-5xl"
          style={{ textShadow: '0 0 20px rgb(0 255 204 / 0.3)' }}
        >
          CAYED
        </h1>
        <p className="text-arcade-muted mt-2 font-mono text-sm tracking-[0.5em] uppercase">
          ARCADE
        </p>
      </div>

      {/* Divider */}
      <div className="bg-arcade-border my-8 h-px w-full max-w-lg" />

      <p className="text-arcade-muted mb-12 font-mono text-xs tracking-widest uppercase">
        SELECT GAME
      </p>

      {/* Game cards */}
      <div className="grid w-full max-w-lg grid-cols-1 gap-6 sm:grid-cols-2">
        {GAMES.map(game => (
          <button
            key={game.id}
            onClick={() => game.available && navigate(game.path)}
            disabled={!game.available}
            className={`group relative border-2 p-8 text-center transition-all duration-100 ${
              game.available
                ? 'border-arcade-cyan bg-arcade-panel hover:bg-arcade-cyan/5 hover:shadow-[0_0_20px_rgba(0,255,204,0.15)] active:scale-[0.98]'
                : 'border-arcade-border bg-arcade-panel/50 cursor-not-allowed opacity-60'
            }`}
          >
            <div
              className={`mb-4 text-5xl ${game.available ? 'text-arcade-cyan' : 'text-arcade-muted'}`}
            >
              {game.icon}
            </div>

            <h2
              className={`font-mono text-lg font-bold tracking-widest uppercase ${
                game.available ? 'text-arcade-text' : 'text-arcade-muted'
              }`}
            >
              {game.name}
            </h2>

            <p className="text-arcade-muted mt-2 font-mono text-xs tracking-wider uppercase">
              {game.description}
            </p>

            <div className="mt-6">
              {game.available ? (
                <span className="border-arcade-cyan text-arcade-cyan group-hover:bg-arcade-cyan group-hover:text-arcade-bg inline-block border px-4 py-1 font-mono text-xs tracking-widest uppercase transition-colors">
                  PLAY
                </span>
              ) : (
                <span className="border-arcade-border text-arcade-muted inline-block border px-4 py-1 font-mono text-xs tracking-widest uppercase">
                  COMING SOON
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-16 text-center">
        <p className="text-arcade-border font-mono text-[10px] tracking-widest uppercase">
          ── ON-CHAIN GAMING ──
        </p>
      </div>
    </div>
  );
}
