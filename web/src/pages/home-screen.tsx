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
        <h1 className="text-arcade-cyan font-pixel text-2xl uppercase sm:text-3xl">
          CAYED
        </h1>
        <p className="text-arcade-muted font-pixel mt-3 text-[8px] uppercase">ARCADE</p>
      </div>

      {/* Divider */}
      <div className="bg-arcade-border my-8 h-1 w-full max-w-lg" />

      <p className="text-arcade-muted font-pixel mb-12 text-[8px] uppercase">
        SELECT GAME
      </p>

      {/* Game cards */}
      <div className="grid w-full max-w-lg grid-cols-1 gap-6 sm:grid-cols-2">
        {GAMES.map(game => (
          <button
            key={game.id}
            onClick={() => game.available && navigate(game.path)}
            disabled={!game.available}
            className={`group border-4 p-8 text-center transition-none ${
              game.available
                ? 'border-arcade-cyan bg-arcade-panel hover:bg-arcade-cyan/10 active:scale-[0.98]'
                : 'border-arcade-border bg-arcade-panel/50 cursor-not-allowed opacity-60'
            }`}
          >
            <div
              className={`mb-4 text-5xl ${game.available ? 'text-arcade-cyan' : 'text-arcade-muted'}`}
            >
              {game.icon}
            </div>

            <h2
              className={`font-pixel text-[10px] uppercase ${
                game.available ? 'text-arcade-text' : 'text-arcade-muted'
              }`}
            >
              {game.name}
            </h2>

            <p className="text-arcade-muted font-pixel mt-3 text-[6px] uppercase">
              {game.description}
            </p>

            <div className="mt-6">
              {game.available ? (
                <span className="border-arcade-cyan text-arcade-cyan group-hover:bg-arcade-cyan group-hover:text-arcade-bg font-pixel inline-block border-4 px-4 py-1.5 text-[7px] uppercase transition-none">
                  PLAY
                </span>
              ) : (
                <span className="border-arcade-border text-arcade-muted font-pixel inline-block border-4 px-4 py-1.5 text-[7px] uppercase">
                  COMING SOON
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-16 text-center">
        <p className="text-arcade-border font-pixel text-[6px] uppercase">
          ── ON-CHAIN GAMING ──
        </p>
      </div>
    </div>
  );
}
