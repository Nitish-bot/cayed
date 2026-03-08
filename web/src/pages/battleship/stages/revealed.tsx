import { isSome } from '@solana/kit';
import { useNavigate } from 'react-router';

import { GameGrid } from '@/components/battleship/game-grid';
import { formatSol, truncateAddress } from '@/lib/constants';
import type { RevealedProps } from '@/pages/battleship/types';

export function RevealedStage({
  game,
  myAddress,
  isPlayer1,
  isPlayer2,
  isPlayer,
  winner,
  myBoardHits,
  attackHits,
}: RevealedProps) {
  const navigate = useNavigate();
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

      {/* Revealed boards */}
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
