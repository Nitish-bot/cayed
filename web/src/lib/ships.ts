import type { ShipCoordinatesArgs } from '@client/cayed';

export type CellCoord = { x: number; y: number };

/** Get all cells occupied by a ship */
export function getShipCells(ship: ShipCoordinatesArgs): CellCoord[] {
  const cells: CellCoord[] = [];
  if (ship.startX === ship.endX) {
    const minY = Math.min(ship.startY, ship.endY);
    const maxY = Math.max(ship.startY, ship.endY);
    for (let y = minY; y <= maxY; y++) cells.push({ x: ship.startX, y });
  } else {
    const minX = Math.min(ship.startX, ship.endX);
    const maxX = Math.max(ship.startX, ship.endX);
    for (let x = minX; x <= maxX; x++) cells.push({ x, y: ship.startY });
  }
  return cells;
}

/** Get ship size from coordinates */
export function getShipSize(ship: ShipCoordinatesArgs): number {
  return getShipCells(ship).length;
}

/** Check if a coordinate is within grid bounds */
function inBounds(x: number, y: number, gridSize: number): boolean {
  return x >= 0 && y >= 0 && x < gridSize && y < gridSize;
}

/** Validate a ship placement against grid bounds and existing ships */
export function validateShipPlacement(
  ship: ShipCoordinatesArgs,
  gridSize: number,
  existingShips: ShipCoordinatesArgs[]
): boolean {
  // Must be horizontal or vertical
  if (ship.startX !== ship.endX && ship.startY !== ship.endY) return false;

  const cells = getShipCells(ship);

  // All cells must be in bounds
  if (!cells.every(c => inBounds(c.x, c.y, gridSize))) return false;

  // No overlap with existing ships
  const occupied = new Set<string>();
  for (const s of existingShips) {
    for (const c of getShipCells(s)) occupied.add(`${c.x},${c.y}`);
  }
  if (cells.some(c => occupied.has(`${c.x},${c.y}`))) return false;

  return true;
}

/** Build a ShipCoordinatesArgs from a start cell, size, and orientation */
export function buildShip(
  startX: number,
  startY: number,
  size: number,
  orientation: 'h' | 'v'
): ShipCoordinatesArgs {
  if (orientation === 'h') {
    return { startX, startY, endX: startX + size - 1, endY: startY };
  }
  return { startX, startY, endX: startX, endY: startY + size - 1 };
}

/** Key for a coordinate to use in Sets/Maps */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
