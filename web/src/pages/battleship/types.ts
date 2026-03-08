import type { CellCoord } from '@/lib/ships';

import type { Game, PlayerBoard, ShipCoordinatesArgs } from '@client/cayed';
import type { Address } from '@solana/kit';

/** Props shared by all stage components. */
export type StageProps = {
  game: Game;
  gameIdStr: string;
  myAddress: Address;
  isPlayer1: boolean;
  isPlayer2: boolean | null | undefined;
  isPlayer: boolean | null | undefined;
};

/** Props for the awaiting-opponent stage. */
export type AwaitingOpponentProps = StageProps & {
  gameLink: string;
  copied: string | boolean;
  copy: (text: string) => Promise<{ success: boolean }>;
};

/** Props for the ship placement stage. */
export type PlacementProps = StageProps & {
  shipSizes: number[];
  placedShips: ShipCoordinatesArgs[];
  currentShipIdx: number;
  orientation: 'h' | 'v';
  previewCells: CellCoord[];
  previewValid: boolean;
  allPlaced: boolean;
  sending: boolean;
  onPlacementClick: (coord: CellCoord) => void;
  onCellHover: (coord: CellCoord | null) => void;
  onRotate: () => void;
  onUndo: () => void;
  onDeploy: () => void;
};

/** Props for the waiting-for-opponent-ships stage. */
export type WaitingShipsProps = StageProps & {
  myBoard: PlayerBoard | null;
};

/** Props for the battle stage. */
export type BattleProps = StageProps & {
  myBoard: PlayerBoard | null;
  opponentBoard: PlayerBoard | null;
  isMyTurn: boolean | null | undefined;
  sending: boolean;
  error: string | null;
  totalMoves: number;
  myBoardHits: CellCoord[];
  myBoardMisses: CellCoord[];
  attackHits: CellCoord[];
  attackMisses: CellCoord[];
  onAttack: (coord: CellCoord) => void;
};

/** Props for the finished stage (Completed, needs reveal). */
export type FinishedProps = StageProps & {
  winner: Address | null;
  revealing: boolean;
  error: string | null;
  onRevealWinner: () => void;
};

/** Props for the revealed stage (WinnerRevealed, final). */
export type RevealedProps = StageProps & {
  winner: Address | null;
  myBoardHits: CellCoord[];
  attackHits: CellCoord[];
};
