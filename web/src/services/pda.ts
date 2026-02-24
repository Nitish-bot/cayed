/**
 * Centralized PDA derivation for all Cayed program accounts.
 *
 * Every PDA the app needs is derived here so that no page/component ever
 * has to assemble raw seeds.
 */
import { getPDAAndBump } from 'solana-kite';

import { CAYED_PROGRAM_ADDRESS } from '@/lib/constants';

import type { Address } from '@solana/kit';

/** All PDAs associated with a specific game + a specific player. */
export type GamePdas = {
  gamePda: Address;
  configPda: Address;
  vaultPda: Address;
  playerBoardPda: Address;
};

/** All PDAs for both players within a game. */
export type FullGamePdas = GamePdas & {
  opponentBoardPda: Address;
};

// ─── Individual derivers ─────────────────────────────────────────────

export async function deriveGamePda(gameId: bigint): Promise<Address> {
  const { pda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, ['game', gameId]);
  return pda;
}

export async function derivePlayerBoardPda(
  gameId: bigint,
  player: Address
): Promise<Address> {
  const { pda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, ['player', gameId, player]);
  return pda;
}

export async function deriveConfigPda(): Promise<Address> {
  const { pda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, ['config']);
  return pda;
}

export async function deriveVaultPda(): Promise<Address> {
  const { pda } = await getPDAAndBump(CAYED_PROGRAM_ADDRESS, ['vault']);
  return pda;
}

// ─── Batch derivers ──────────────────────────────────────────────────

/** Derive the core set of PDAs needed for a single player in a game. */
export async function deriveGamePdas(gameId: bigint, player: Address): Promise<GamePdas> {
  const [gamePda, configPda, vaultPda, playerBoardPda] = await Promise.all([
    deriveGamePda(gameId),
    deriveConfigPda(),
    deriveVaultPda(),
    derivePlayerBoardPda(gameId, player),
  ]);
  return { gamePda, configPda, vaultPda, playerBoardPda };
}

/** Derive PDAs for both players in a game. */
export async function deriveFullGamePdas(
  gameId: bigint,
  player: Address,
  opponent: Address
): Promise<FullGamePdas> {
  const [base, opponentBoardPda] = await Promise.all([
    deriveGamePdas(gameId, player),
    derivePlayerBoardPda(gameId, opponent),
  ]);
  return { ...base, opponentBoardPda };
}
