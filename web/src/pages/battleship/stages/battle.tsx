import { GameGrid } from '@/components/battleship/game-grid';
import type { BattleProps } from '@/pages/battleship/types';

function statusMessage(
  battleStarted: boolean,
  isMyTurn: boolean | null | undefined
): string {
  if (!battleStarted) {
    return isMyTurn
      ? 'Your fleet is ready — pick a target and press Fire'
      : 'Waiting for opponent to deploy or take their turn';
  }
  if (isMyTurn) return 'Your turn — pick a target and press Fire';
  return 'Opponent is aiming…';
}

export function BattleStage({
  game,
  myBoard,
  isMyTurn,
  canAttack,
  sending,
  error,
  totalMoves,
  myBoardHits,
  myBoardMisses,
  attackHits,
  attackMisses,
  selectedTarget,
  onSelectTarget,
  onFire,
}: BattleProps) {
  const statusKind = game.status.__kind;
  const battleStarted = statusKind === 'InProgress';
  const gameOver =
    statusKind === 'Completed' ||
    statusKind === 'Forfeited' ||
    statusKind === 'WinnerRevealed';
  const canSelect = !!canAttack && !!isMyTurn && !sending && !gameOver;
  const targetKey = selectedTarget ? `${selectedTarget.x},${selectedTarget.y}` : null;
  const alreadyAttacked =
    targetKey != null &&
    (attackHits.some(h => `${h.x},${h.y}` === targetKey) ||
      attackMisses.some(m => `${m.x},${m.y}` === targetKey));
  const canFire = canSelect && selectedTarget != null && !alreadyAttacked;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 text-center">
        <p className="text-arcade-muted font-pixel text-[9px] tracking-wide uppercase">
          {statusMessage(battleStarted, isMyTurn)}
        </p>
        {sending && (
          <p className="text-arcade-yellow font-pixel mt-2 text-[7px]">Firing...</p>
        )}
      </div>

      {error && (
        <div className="border-arcade-red bg-arcade-red/10 mb-4 border-4 p-3 text-center">
          <p className="text-arcade-red font-pixel text-[7px]">{error}</p>
        </div>
      )}

      <div className="flex flex-col items-center justify-center gap-8 lg:flex-row lg:items-start lg:gap-12">
        <GameGrid
          gridSize={game.gridSize}
          ships={myBoard?.shipCoordinates ?? []}
          hits={myBoardHits}
          misses={myBoardMisses}
          label="YOUR WATERS"
        />

        <div className="text-arcade-muted font-pixel hidden text-lg lg:flex lg:items-center lg:self-center">
          VS
        </div>

        <GameGrid
          gridSize={game.gridSize}
          hits={attackHits}
          misses={attackMisses}
          selectedCells={selectedTarget ? [selectedTarget] : []}
          interactive={canSelect}
          onCellClick={onSelectTarget}
          label="ENEMY WATERS"
        />
      </div>

      {gameOver && (
        <p className="text-arcade-yellow font-pixel mt-4 text-center text-[8px]">
          GAME OVER — WAITING FOR STATE SYNC
        </p>
      )}

      {canAttack && isMyTurn && !gameOver && (
        <div className="mt-8 flex flex-col items-center gap-3">
          {selectedTarget && (
            <p className="text-arcade-cyan font-pixel text-[8px] uppercase">
              Target: {String.fromCharCode(65 + selectedTarget.x)}
              {selectedTarget.y + 1}
            </p>
          )}
          <button
            type="button"
            onClick={onFire}
            disabled={!canFire || sending}
            className="border-arcade-red bg-arcade-red/10 text-arcade-red hover:bg-arcade-red hover:text-arcade-bg font-pixel border-4 px-10 py-3 text-[9px] uppercase transition-none active:scale-95 disabled:opacity-40"
          >
            {sending ? 'Firing...' : 'Fire!'}
          </button>
        </div>
      )}

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
