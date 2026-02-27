import { Fragment, useMemo } from 'react';

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
  empty: 'bg-arcade-panel border-arcade-border hover:bg-[rgb(35_28_55)] cursor-pointer',
  ship: 'bg-arcade-green/70 border-arcade-green',
  hit: 'bg-arcade-red border-arcade-red',
  miss: 'bg-[rgb(40_35_60)] border-[rgb(65_55_90)]',
  sunk: 'bg-arcade-red/50 border-arcade-red/60',
  preview: 'bg-arcade-cyan/25 border-arcade-cyan/50',
  'preview-invalid': 'bg-arcade-red/25 border-arcade-red/50',
};

/**
 * Renders a game grid with correct on-chain dimensions:
 * - Columns: gridSize
 * - Rows: gridSize / 2  (each player's board is a half-grid)
 */
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
  const rows = gridSize / 2;

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
        <p className="text-arcade-muted font-pixel mb-2 text-center text-[8px] tracking-widest uppercase">
          {label}
        </p>
      )}

      <div
        className="inline-grid gap-0"
        style={{ gridTemplateColumns: `24px repeat(${gridSize}, 1fr)` }}
      >
        {/* Top-left corner */}
        <div />
        {/* Column headers */}
        {colHeaders.map(h => (
          <div
            key={h}
            className="text-arcade-muted font-pixel flex h-5 items-center justify-center text-[7px]"
          >
            {h}
          </div>
        ))}

        {/* Rows – only gridSize/2 rows */}
        {Array.from({ length: rows }, (_, y) => (
          <Fragment key={`row-${y}`}>
            {/* Row header */}
            <div
              className="text-arcade-muted font-pixel flex w-6 items-center justify-center text-[7px]"
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
                  className={`flex size-10 items-center justify-center border-2 transition-none sm:size-11 md:size-12 ${STATE_CLASSES[state]} ${
                    isClickable ? 'cursor-crosshair' : interactive ? 'cursor-default' : ''
                  }`}
                  onClick={() => onCellClick?.({ x, y })}
                  onMouseEnter={() => onCellHover?.({ x, y })}
                  onMouseLeave={() => onCellHover?.(null)}
                  disabled={!interactive && !onCellClick}
                  type="button"
                >
                  {state === 'hit' && (
                    <span className="font-pixel text-[10px] text-white">✕</span>
                  )}
                  {state === 'miss' && (
                    <span className="text-arcade-muted font-pixel text-[8px]">·</span>
                  )}
                  {state === 'ship' && (
                    <span className="text-arcade-green font-pixel text-[8px]">■</span>
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
