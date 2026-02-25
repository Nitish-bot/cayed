/**
 * Unified service for all Cayed program interactions.
 *
 * - Bundles permission creation + delegation with game lifecycle ops
 * - Routes transactions to the correct connection (devnet vs ephemeral)
 * - Centralised PDA derivation via `services/pda.ts`
 * - Provides auth-token management for TEE-based ephemeral validators
 */
import {
  accountType,
  getCreateGameInstruction,
  getCreatePermissionInstruction,
  getDelegatePdaInstruction,
  getHideShipsInstruction,
  getJoinGameInstruction,
  getMakeMoveInstruction,
  getRevealWinnerInstruction,
  type ShipCoordinatesArgs,
} from '@client/cayed';
import {
  AUTHORITY_FLAG,
  TX_LOGS_FLAG,
  createDelegatePermissionInstruction,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  getAuthToken,
  permissionPdaFromAccount,
  waitUntilPermissionActive,
} from '@magicblock-labs/ephemeral-rollups-kit';
import {
  address,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import { connect, type Connection } from 'solana-kite';

import { CAYED_PROGRAM_ADDRESS } from '@/lib/constants';
import { sendTransactionWithWallet } from '@/lib/send-transaction';
import { deriveGamePdas, derivePlayerBoardPda, type GamePdas } from '@/services/pda';

// ─── Configuration ───────────────────────────────────────────────────

export interface GameServiceConfig {
  /** Base-layer (devnet) RPC HTTP URL. */
  devnetUrl: string;
  /** Base-layer (devnet) RPC WS URL. */
  devnetWsUrl: string;
  /** Ephemeral-rollup RPC HTTP URL. */
  ephemeralUrl: string;
  /** Ephemeral-rollup RPC WS URL. */
  ephemeralWsUrl: string;
  /** Address of the ER validator to delegate to. */
  erValidator: Address;
}

/**
 * Default config targeting MagicBlock devnet infrastructure.
 * Override via env vars if needed (Vite: `import.meta.env.VITE_*`).
 */
export const DEFAULT_GAME_SERVICE_CONFIG: GameServiceConfig = {
  devnetUrl: import.meta.env.VITE_BASE_URL ?? 'https://api.devnet.solana.com',
  devnetWsUrl: import.meta.env.VITE_BASE_WS_URL ?? 'wss://api.devnet.solana.com',
  ephemeralUrl: import.meta.env.VITE_EPHEMERAL_URL ?? 'https://tee.magicblock.app',
  ephemeralWsUrl: import.meta.env.VITE_EPHEMERAL_WS_URL ?? 'wss://tee.magicblock.app',
  erValidator: address(
    import.meta.env.VITE_ER_VALIDATOR ?? 'FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA'
  ),
};

// ─── Service ─────────────────────────────────────────────────────────

export class GameService {
  readonly devnet: Connection;
  private ephemeralBase: Connection;
  private ephemeralAuthed: Connection | null = null;
  private readonly config: GameServiceConfig;

  constructor(config: GameServiceConfig = DEFAULT_GAME_SERVICE_CONFIG) {
    this.config = config;
    this.devnet = connect(config.devnetUrl, config.devnetWsUrl);
    this.ephemeralBase = connect(config.ephemeralUrl, config.ephemeralWsUrl);
  }

  /** The ephemeral connection – authed if `authenticate()` was called, base otherwise. */
  get ephemeral(): Connection {
    return this.ephemeralAuthed ?? this.ephemeralBase;
  }

  // ─── Auth ────────────────────────────────────────────────────────

  /**
   * Authenticate with the ephemeral validator (required for TEE endpoints).
   * Call once after wallet connect; the authed connection is re-used for the
   * lifetime of this service instance.
   *
   * @param playerAddress  The wallet address.
   * @param signMessage    Signing function (e.g. from wallet adapter signMessage).
   */
  async authenticate(
    playerAddress: Address,
    signMessage: (message: Uint8Array) => Promise<Uint8Array>
  ): Promise<void> {
    const isTee = this.config.ephemeralUrl.includes('tee');
    if (!isTee) return; // non-TEE endpoints don't need auth tokens

    const { token } = await getAuthToken(
      this.config.ephemeralUrl,
      playerAddress,
      signMessage
    );
    this.ephemeralAuthed = connect(
      `${this.config.ephemeralUrl}?token=${token}`,
      this.config.ephemeralWsUrl
    );
  }

  // ─── High-level game operations ──────────────────────────────────

  /**
   * Create a new game **and** delegate the creator's player-board to the ER.
   *
   * Sends a single transaction containing:
   * 1. `createGame`
   * 2. `createPermission` (player board)
   * 3. `delegatePermission` (player board)
   * 4. `delegatePda` (player board)
   */
  async createGame(opts: {
    player: TransactionSigner;
    gameId: bigint;
    gridSize: number;
    wager: bigint;
  }): Promise<{ pdas: GamePdas }> {
    const { player, gameId, gridSize, wager } = opts;
    const pdas = await deriveGamePdas(gameId, player.address);

    // 1. Create game instruction
    const createGameIx = getCreateGameInstruction({
      player,
      game: pdas.gamePda,
      playerBoard: pdas.playerBoardPda,
      config: pdas.configPda,
      vault: pdas.vaultPda,
      id: gameId,
      gridSize,
      wager,
    });

    // 2-4. Permission + delegation for the player board
    const delegationIxs = await this.buildBoardDelegationIxs(
      player,
      pdas.playerBoardPda,
      gameId
    );

    await this.sendOnDevnet(player, [createGameIx, ...delegationIxs]);
    return { pdas };
  }

  /**
   * Join an existing game, delegate both the joiner's board **and** the Game
   * PDA to the ER.
   *
   * Sends a single transaction containing:
   * 1. `joinGame`
   * 2. `delegatePda` (game) — game is delegated here because player2 is set
   * 3. `createPermission` (player2 board)
   * 4. `delegatePermission` (player2 board)
   * 5. `delegatePda` (player2 board)
   */
  async joinGame(opts: {
    player: TransactionSigner;
    gameId: bigint;
  }): Promise<{ playerBoardPda: Address }> {
    const { player, gameId } = opts;
    const { gamePda, vaultPda } = await deriveGamePdas(gameId, player.address);
    const playerBoardPda = await derivePlayerBoardPda(gameId, player.address);

    // 1. Join game
    const joinGameIx = getJoinGameInstruction({
      player,
      game: gamePda,
      playerBoard: playerBoardPda,
      vault: vaultPda,
    });

    // 2. Delegate the Game PDA
    const gameDelegateIxs = await this.buildGameDelegationIx(player, gamePda, gameId);

    // 3-5. Permission + delegation for the joiner's board
    const boardDelegateIxs = await this.buildBoardDelegationIxs(
      player,
      playerBoardPda,
      gameId
    );

    await this.sendOnDevnet(player, [
      joinGameIx,
      ...gameDelegateIxs,
      ...boardDelegateIxs,
    ]);

    return { playerBoardPda };
  }

  /**
   * Place ships on the player's board.  Sent on the **ephemeral** connection.
   *
   * Optionally waits for the board permission to become active on the ER
   * before sending (set `waitForPermission: true`).
   */
  async hideShips(opts: {
    player: TransactionSigner;
    gamePda: Address;
    playerBoardPda: Address;
    ships: ShipCoordinatesArgs[];
    waitForPermission?: boolean;
  }): Promise<void> {
    const { player, gamePda, playerBoardPda, ships, waitForPermission } = opts;

    if (waitForPermission) {
      await waitUntilPermissionActive(this.config.ephemeralUrl, playerBoardPda);
    }

    const ix = getHideShipsInstruction({
      player,
      game: gamePda,
      playerBoard: playerBoardPda,
      ships,
    });

    await this.sendOnEphemeral(player, [ix]);
  }

  /**
   * Make a move (attack) on the opponent's board.
   * Sent on the **ephemeral** connection.
   */
  async makeMove(opts: {
    player: TransactionSigner;
    opponent: Address;
    gamePda: Address;
    playerBoardPda: Address;
    opponentBoardPda: Address;
    x: number;
    y: number;
  }): Promise<void> {
    const { player, opponent, gamePda, playerBoardPda, opponentBoardPda, x, y } = opts;

    const ix = getMakeMoveInstruction({
      player,
      opponent,
      game: gamePda,
      playerBoard: playerBoardPda,
      opponentBoard: opponentBoardPda,
      x,
      y,
    });

    await this.sendOnEphemeral(player, [ix]);
  }

  /**
   * Reveal the winner and commit+undelegate all accounts back to devnet.
   * Sent on the **ephemeral** connection.
   */
  async revealWinner(opts: {
    payer: TransactionSigner;
    gamePda: Address;
    player1BoardPda: Address;
    player2BoardPda: Address;
  }): Promise<void> {
    const { payer, gamePda, player1BoardPda, player2BoardPda } = opts;

    const [permission1, permission2] = await Promise.all([
      permissionPdaFromAccount(player1BoardPda),
      permissionPdaFromAccount(player2BoardPda),
    ]);

    const ix = getRevealWinnerInstruction({
      game: gamePda,
      player1Board: player1BoardPda,
      player2Board: player2BoardPda,
      permission1,
      permission2,
      payer,
    });

    await this.sendOnEphemeral(payer, [ix]);
  }

  // ─── Permission helpers ──────────────────────────────────────────

  /**
   * Wait until a board's permission is active on the ephemeral validator.
   * Returns `true` if active, throws on timeout.
   */
  async waitForBoardActive(boardPda: Address, timeout?: number): Promise<boolean> {
    return waitUntilPermissionActive(this.config.ephemeralUrl, boardPda, timeout);
  }

  // ─── Internal: delegation instruction builders ────────────────────

  /**
   * Build the three instructions to permission + delegate a PlayerBoard PDA:
   * 1. createPermission  (Cayed client)
   * 2. delegatePermission (ER kit)
   * 3. delegatePda (Cayed client, wraps delegation program)
   */
  private async buildBoardDelegationIxs(
    player: TransactionSigner,
    boardPda: Address,
    gameId: bigint
  ): Promise<Instruction[]> {
    const permission = await permissionPdaFromAccount(boardPda);
    const members = [{ flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player.address }];
    const pbAccountType = accountType('PlayerBoard', {
      gameId,
      player: player.address,
    });

    const createPermIx = getCreatePermissionInstruction({
      payer: player,
      permissionedAccount: boardPda,
      permission,
      members,
      accountType: pbAccountType,
    });

    const delegatePermIx = await createDelegatePermissionInstruction({
      payer: player.address,
      authority: [player.address, true],
      permissionedAccount: [boardPda, false],
      validator: this.config.erValidator,
    });

    const [buffer, delegationRecord, delegationMetadata] = await Promise.all([
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        boardPda,
        CAYED_PROGRAM_ADDRESS
      ),
      delegationRecordPdaFromDelegatedAccount(boardPda),
      delegationMetadataPdaFromDelegatedAccount(boardPda),
    ]);

    const delegatePdaIx = getDelegatePdaInstruction({
      payer: player,
      pda: boardPda,
      validator: this.config.erValidator,
      bufferPda: buffer,
      delegationRecordPda: delegationRecord,
      delegationMetadataPda: delegationMetadata,
      accountType: pbAccountType,
    });

    return [createPermIx, delegatePermIx, delegatePdaIx];
  }

  /**
   * Build the delegatePda instruction for the Game account itself.
   * (No permission needed — the Game PDA is not permissioned.)
   */
  private async buildGameDelegationIx(
    player: TransactionSigner,
    gamePda: Address,
    gameId: bigint
  ): Promise<Instruction[]> {
    const gameAccType = accountType('Game', { gameId });

    const [buffer, delegationRecord, delegationMetadata] = await Promise.all([
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        gamePda,
        CAYED_PROGRAM_ADDRESS
      ),
      delegationRecordPdaFromDelegatedAccount(gamePda),
      delegationMetadataPdaFromDelegatedAccount(gamePda),
    ]);

    const delegateGameIx = getDelegatePdaInstruction({
      payer: player,
      pda: gamePda,
      validator: this.config.erValidator,
      bufferPda: buffer,
      delegationRecordPda: delegationRecord,
      delegationMetadataPda: delegationMetadata,
      accountType: gameAccType,
    });

    return [delegateGameIx];
  }

  // ─── Internal: transaction senders ────────────────────────────────

  private async sendOnDevnet(
    feePayer: TransactionSigner,
    instructions: Instruction[]
  ): Promise<void> {
    await sendTransactionWithWallet({
      connection: this.devnet,
      feePayer,
      instructions,
    });
  }

  private async sendOnEphemeral(
    feePayer: TransactionSigner,
    instructions: Instruction[]
  ): Promise<void> {
    await sendTransactionWithWallet({
      connection: this.ephemeral,
      feePayer,
      instructions,
    });
  }
}
