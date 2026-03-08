import { useNavigate } from 'react-router';

import { formatSol, gridDisplay } from '@/lib/constants';
import type { AwaitingOpponentProps } from '@/pages/battleship/types';

export function AwaitingOpponentStage({
  game,
  gameIdStr,
  gameLink,
  copied,
  copy,
}: AwaitingOpponentProps) {
  const navigate = useNavigate();

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
          GRID: <span className="text-arcade-cyan">{gridDisplay(game.gridSize)}</span>
        </p>
        <p className="text-arcade-muted font-pixel mt-3 text-[8px]">
          WAGER: <span className="text-arcade-yellow">{formatSol(game.wager)} SOL</span>
        </p>
      </div>

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
