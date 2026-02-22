import { CAYED_PROGRAM_ADDRESS } from '@client/cayed';

export { CAYED_PROGRAM_ADDRESS };

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Ship sizes for a given grid size. Max 5 ships (program limit). */
export function getShipSizes(gridSize: number): number[] {
  if (gridSize <= 4) return [2, 1];
  if (gridSize <= 5) return [3, 2, 1];
  if (gridSize <= 6) return [3, 2, 1];
  if (gridSize <= 7) return [4, 3, 2, 1];
  if (gridSize <= 8) return [4, 3, 2, 1];
  return [5, 4, 3, 2, 1];
}

/** Total cells occupied by all ships for a grid size */
export function getTotalShipCells(gridSize: number): number {
  return getShipSizes(gridSize).reduce((sum, s) => sum + s, 0);
}
