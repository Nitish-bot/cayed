import { useNavigate } from 'react-router';

import { formatSol, truncateAddress } from '@/lib/constants';
import type { FinishedProps } from '@/pages/battleship/types';

export function FinishedStage({
  game,
  myAddress,
  isPlayer,
  winner,
  revealing,
  error,
  onRevealWinner,
}: FinishedProps) {
  const navigate = useNavigate();
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
            onClick={onRevealWinner}
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
            WAGER: <span className="text-arcade-yellow">{formatSol(game.wager)} SOL</span>
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
