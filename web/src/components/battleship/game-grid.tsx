import { useMemo } from 'react';

import { type ShipCoordinatesArgs } from '@client/cayed';

import { cellKey, getShipCells, type CellCoord } from '@/lib/ships';

export type CellState =
  | 'empty'
  | 'ship'
  | 'hit'
  | 'miss'
  | 'sunk'
  | 'preview'
  | 'preview-invalid';

type Props = {
  gridSize: number;
  ships?: ShipCoordinatesArgs[];
  hits?: CellCoord[];
  misses?: CellCoord[];
  previewCells?: CellCoord[];
  previewValid?: boolean;
  revealedShips?: ShipCoordinatesArgs[];
  interactive?: boolean;
  onCellClick?: (coord: CellCoord) => void;
  onCellHover?: (coord: CellCoord | null) => void;
  label?: string;
};

const STATE_CLASSES: Record<CellState, string> = {
  empty: 'bg-arcade-panel border-arcade-border hover:bg-[rgb(30_30_50)] cursor-pointer',
  ship: 'bg-arcade-green/80 border-arcade-green/40',
  hit: 'bg-arcade-red border-arcade-red/40',
  miss: 'bg-[rgb(40_40_70)] border-[rgb(60_60_90)]',
  sunk: 'bg-arcade-red/60 border-arcade-red/30',
  preview: 'bg-arcade-cyan/30 border-arcade-cyan/40',
  'preview-invalid': 'bg-arcade-red/30 border-arcade-red/40',
};

export function GameGrid({
  gridSize,
  ships = [],
  hits = [],
  misses = [],
  previewCells = [],
  previewValid = true,
  revealedShips = [],
  interactive = false,
  onCellClick,
  onCellHover,
  label,
}: Props) {
  // Build lookup maps
  const cellStates = useMemo(() => {
    const map = new Map<string, CellState>();

    // Ships (own board)
    for (const ship of ships) {
      for (const c of getShipCells(ship)) map.set(cellKey(c.x, c.y), 'ship');
    }

    // Revealed ships (opponent board after game ends)
    for (const ship of revealedShips) {
      for (const c of getShipCells(ship)) {
        if (!map.has(cellKey(c.x, c.y))) map.set(cellKey(c.x, c.y), 'ship');
      }
    }

    // Hits
    for (const h of hits) map.set(cellKey(h.x, h.y), 'hit');

    // Misses
    for (const m of misses) {
      if (!map.has(cellKey(m.x, m.y))) map.set(cellKey(m.x, m.y), 'miss');
    }

    // Preview
    for (const p of previewCells) {
      const key = cellKey(p.x, p.y);
      if (!map.has(key)) {
        map.set(key, previewValid ? 'preview' : 'preview-invalid');
      }
    }

    return map;
  }, [ships, hits, misses, previewCells, previewValid, revealedShips]);

  const colHeaders = useMemo(
    () => Array.from({ length: gridSize }, (_, i) => String.fromCharCode(65 + i)),
    [gridSize]
  );

  return (
    <div className="inline-block">
      {label && (
        <p className="text-arcade-muted mb-2 text-center font-mono text-xs tracking-widest uppercase">
          {label}
        </p>
      )}

      <div
        className="inline-grid"
        style={{ gridTemplateColumns: `28px repeat(${gridSize}, 1fr)` }}
      >
        {/* Top-left corner */}
        <div />
        {/* Column headers */}
        {colHeaders.map(h => (
          <div
            key={h}
            className="text-arcade-muted flex h-5 items-center justify-center font-mono text-[10px]"
          >
            {h}
          </div>
        ))}

        {/* Rows */}
        {Array.from({ length: gridSize }, (_, y) => (
          <>
            {/* Row header */}
            <div
              key={`rh-${y}`}
              className="text-arcade-muted flex w-7 items-center justify-center font-mono text-[10px]"
            >
              {y + 1}
            </div>
            {/* Cells */}
            {Array.from({ length: gridSize }, (_, x) => {
              const state = cellStates.get(cellKey(x, y)) ?? 'empty';
              const isClickable = interactive && state === 'empty';

              return (
                <button
                  key={`${x}-${y}`}
                  className={`flex size-10 items-center justify-center border transition-colors duration-75 sm:size-11 md:size-12 ${STATE_CLASSES[state]} ${
                    isClickable ? 'cursor-crosshair' : interactive ? 'cursor-default' : ''
                  }`}
                  onClick={() => onCellClick?.({ x, y })}
                  onMouseEnter={() => onCellHover?.({ x, y })}
                  onMouseLeave={() => onCellHover?.(null)}
                  disabled={!interactive && !onCellClick}
                  type="button"
                >
                  {state === 'hit' && (
                    <span className="font-mono text-sm font-bold text-white">✕</span>
                  )}
                  {state === 'miss' && (
                    <span className="text-arcade-muted text-xs">•</span>
                  )}
                  {state === 'ship' && (
                    <span className="text-arcade-green text-xs">■</span>
                  )}
                </button>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
