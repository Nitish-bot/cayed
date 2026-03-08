import { GameGrid } from '@/components/battleship/game-grid';
import type { WaitingShipsProps } from '@/pages/battleship/types';

export function WaitingShipsStage({ game, myBoard }: WaitingShipsProps) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h2 className="text-arcade-yellow font-pixel animate-pixel-blink mb-4 text-xs uppercase">
        FLEET DEPLOYED!
      </h2>
      <p className="text-arcade-muted font-pixel text-[8px]">
        WAITING FOR OPPONENT TO DEPLOY THEIR FLEET...
      </p>

      {/* Show just your board */}
      <div className="mt-8 flex justify-center">
        <GameGrid
          gridSize={game.gridSize}
          ships={myBoard?.shipCoordinates ?? []}
          label="YOUR FLEET"
        />
      </div>
    </div>
  );
}
