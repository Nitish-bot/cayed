import { GameGrid } from '@/components/battleship/game-grid';
import type { BattleProps } from '@/pages/battleship/types';

export function BattleStage({
  game,
  myBoard,
  opponentBoard,
  isMyTurn,
  sending,
  error,
  totalMoves,
  myBoardHits,
  myBoardMisses,
  attackHits,
  attackMisses,
  onAttack,
}: BattleProps) {
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
          onCellClick={onAttack}
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
