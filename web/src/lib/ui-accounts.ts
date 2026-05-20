import type { Game, GameStatus, PlayerBoard } from '@client/cayed';
import type { MaybeAccount } from '@solana/kit';

/**
 * On-chain account types decoded by Codama use `bigint` for u64 fields.
 * React 19 dev tooling JSON-serializes component state and throws on bigint,
 * which breaks renders and all UI interaction. Store these UI-safe copies instead.
 */
export type UiGame = Omit<Game, 'id' | 'wager'> & {
  id: number;
  wager: number;
};

export type UiPlayerBoard = Omit<
  PlayerBoard,
  'gameId' | 'shipMasks' | 'allShipsMask' | 'hitsBitmap'
> & {
  gameId: number;
  shipMasks: number[];
  allShipsMask: number;
  hitsBitmap: number;
};

const TERMINAL_GAME_STATUSES = new Set<GameStatus['__kind']>([
  'Completed',
  'Forfeited',
  'WinnerRevealed',
  'Cancelled',
]);

function isTerminalStatus(status: GameStatus): boolean {
  return TERMINAL_GAME_STATUSES.has(status.__kind);
}

/** Prefer ER during play; prefer terminal status from either source. */
export function pickAuthoritativeGame(
  ephemeral: MaybeAccount<Game>,
  base: MaybeAccount<Game>
): MaybeAccount<Game> {
  if (!ephemeral.exists && !base.exists) return ephemeral;
  if (!ephemeral.exists && base.exists) return base;
  if (ephemeral.exists && !base.exists) return ephemeral;
  if (!ephemeral.exists || !base.exists) return ephemeral;

  const e = ephemeral.data;
  const b = base.data;
  const eTerminal = isTerminalStatus(e.status);
  const bTerminal = isTerminalStatus(b.status);
  if (eTerminal && !bTerminal) return ephemeral;
  if (bTerminal && !eTerminal) return base;
  return e.moves.length >= b.moves.length ? ephemeral : base;
}

export function toUiGame(game: Game): UiGame {
  return {
    discriminator: game.discriminator,
    gridSize: game.gridSize,
    player1: game.player1,
    player2: game.player2,
    revealedShipsPlayer1: game.revealedShipsPlayer1,
    revealedShipsPlayer2: game.revealedShipsPlayer2,
    moves: game.moves,
    nextMovePlayer1: game.nextMovePlayer1,
    status: game.status,
    bump: game.bump,
    id: Number(game.id),
    wager: Number(game.wager),
  };
}

export function toUiPlayerBoard(board: PlayerBoard): UiPlayerBoard {
  return {
    discriminator: board.discriminator,
    player: board.player,
    bump: board.bump,
    shipCoordinates: board.shipCoordinates,
    sunkMask: board.sunkMask,
    gameId: Number(board.gameId),
    shipMasks: board.shipMasks.map(m => Number(m)),
    allShipsMask: Number(board.allShipsMask),
    hitsBitmap: Number(board.hitsBitmap),
  };
}
