import type { CellCoord } from '@/lib/ships';

import type { PlayerBoard, ShipCoordinates } from '@client/cayed';

// ─── Bitmap → UI coordinate helpers ──────────────────────────────────
//
// The on-chain PlayerBoard stores hits/ships as u64 bitmasks where
// bit index = y * gridSize + x.  These helpers let the UI stay in
// {x, y} land without ever thinking about bitmasks.

/** Convert a grid-cell bitmask into an array of {x,y} coordinates. */
export function bitmaskToCells(mask: bigint, gridSize: number): CellCoord[] {
  const cells: CellCoord[] = [];
  let remaining = mask;
  let idx = 0;
  while (remaining > 0n) {
    if (remaining & 1n) {
      cells.push({ x: idx % gridSize, y: Math.floor(idx / gridSize) });
    }
    remaining >>= 1n;
    idx++;
  }
  return cells;
}

/** Convert an {x,y} coordinate to a bit index for a given grid size. */
export function cellToBitIndex(x: number, y: number, gridSize: number): number {
  return y * gridSize + x;
}

/** Set a single bit in a bitmask. */
export function setBit(mask: bigint, x: number, y: number, gridSize: number): bigint {
  return mask | (1n << BigInt(cellToBitIndex(x, y, gridSize)));
}

/** Test whether a single bit is set in a bitmask. */
export function testBit(mask: bigint, x: number, y: number, gridSize: number): boolean {
  return (mask & (1n << BigInt(cellToBitIndex(x, y, gridSize)))) !== 0n;
}

// ─── Derived hit/miss/sunk from PlayerBoard ──────────────────────────

/**
 * All cells that were attacked on this board (both hits and misses).
 * These are the cells in `hitsBitmap`.
 */
export function getAttackedCells(board: PlayerBoard, gridSize: number): CellCoord[] {
  return bitmaskToCells(board.hitsBitmap, gridSize);
}

/**
 * Cells that were attacked AND contain a ship (hit = attacked ∩ ship).
 */
export function getHitCells(board: PlayerBoard, gridSize: number): CellCoord[] {
  const hitMask = board.hitsBitmap & board.allShipsMask;
  return bitmaskToCells(hitMask, gridSize);
}

/**
 * Cells that were attacked but DON'T contain a ship (miss = attacked \ ship).
 */
export function getMissCells(board: PlayerBoard, gridSize: number): CellCoord[] {
  const missMask = board.hitsBitmap & ~board.allShipsMask;
  return bitmaskToCells(missMask, gridSize);
}

/** All cells occupied by any ship on this board. */
export function getOccupiedCells(board: PlayerBoard, gridSize: number): CellCoord[] {
  return bitmaskToCells(board.allShipsMask, gridSize);
}

/**
 * Returns which ships have been sunk (by index into `shipCoordinates`).
 */
export function getSunkShipIndices(board: PlayerBoard): number[] {
  const indices: number[] = [];
  let mask = board.sunkMask;
  let i = 0;
  while (mask > 0) {
    if (mask & 1) indices.push(i);
    mask >>= 1;
    i++;
  }
  return indices;
}

/**
 * Returns the ShipCoordinates of all sunk ships on this board.
 */
export function getSunkShips(board: PlayerBoard): ShipCoordinates[] {
  return getSunkShipIndices(board).map(i => board.shipCoordinates[i]!);
}

/**
 * True when a specific cell at (x, y) was attacked on this board.
 */
export function wasAttacked(
  board: PlayerBoard,
  x: number,
  y: number,
  gridSize: number
): boolean {
  return testBit(board.hitsBitmap, x, y, gridSize);
}

/**
 * True when a specific cell at (x, y) was attacked AND is a ship cell.
 */
export function wasHit(
  board: PlayerBoard,
  x: number,
  y: number,
  gridSize: number
): boolean {
  return (
    testBit(board.hitsBitmap, x, y, gridSize) &&
    testBit(board.allShipsMask, x, y, gridSize)
  );
}
