import { GameGrid } from '@/components/battleship/game-grid';
import type { PlacementProps } from '@/pages/battleship/types';

export function PlacementStage({
  game,
  shipSizes,
  placedShips,
  currentShipIdx,
  orientation,
  previewCells,
  previewValid,
  allPlaced,
  sending,
  onPlacementClick,
  onCellHover,
  onRotate,
  onUndo,
  onDeploy,
}: PlacementProps) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h2 className="text-arcade-cyan font-pixel mb-6 text-center text-xs tracking-widest uppercase">
        DEPLOY YOUR FLEET
      </h2>

      {/* Ship list */}
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        {shipSizes.map((size, idx) => (
          <div
            key={idx}
            className={`font-pixel border-4 px-3 py-1.5 text-[7px] uppercase ${
              idx < currentShipIdx
                ? 'border-arcade-green text-arcade-green'
                : idx === currentShipIdx
                  ? 'border-arcade-cyan text-arcade-cyan animate-pixel-blink'
                  : 'border-arcade-border text-arcade-muted'
            }`}
          >
            {idx < currentShipIdx ? '✓ ' : ''}
            {size === 1
              ? 'SCOUT'
              : size === 2
                ? 'PATROL'
                : size === 3
                  ? 'CRUISER'
                  : size === 4
                    ? 'BATTLESHIP'
                    : 'CARRIER'}{' '}
            ({size})
          </div>
        ))}
      </div>

      {/* Controls */}
      {!allPlaced && (
        <div className="mb-4 flex items-center justify-center gap-4">
          <button
            onClick={onRotate}
            className="border-arcade-border text-arcade-muted hover:border-arcade-cyan hover:text-arcade-cyan font-pixel border-4 px-3 py-1 text-[7px] transition-none"
          >
            {orientation === 'h' ? '→ HORIZONTAL' : '↓ VERTICAL'} [R]
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="flex justify-center">
        <GameGrid
          gridSize={game.gridSize}
          ships={placedShips}
          previewCells={previewCells}
          previewValid={previewValid}
          interactive={!allPlaced}
          onCellClick={onPlacementClick}
          onCellHover={onCellHover}
          label="PLACE YOUR SHIPS"
        />
      </div>

      {/* Undo + Deploy */}
      <div className="mt-6 flex items-center justify-center gap-4">
        {placedShips.length > 0 && (
          <button
            onClick={onUndo}
            className="border-arcade-red text-arcade-red hover:bg-arcade-red hover:text-arcade-bg font-pixel border-4 px-4 py-2 text-[7px] uppercase transition-none"
          >
            UNDO
          </button>
        )}

        {allPlaced && (
          <button
            onClick={onDeploy}
            disabled={sending}
            className="border-arcade-green bg-arcade-green/10 text-arcade-green hover:bg-arcade-green hover:text-arcade-bg font-pixel border-4 px-8 py-3 text-[8px] uppercase transition-none active:scale-95 disabled:opacity-40"
          >
            {sending ? 'DEPLOYING...' : 'DEPLOY FLEET'}
          </button>
        )}
      </div>
    </div>
  );
}
