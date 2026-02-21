import {
  CAYED_PROGRAM_ADDRESS,
  CONFIG_DISCRIMINATOR,
  GAME_DISCRIMINATOR,
  getConfigDecoder,
  getCreateGameInstruction,
  getGameDecoder,
  getInitConfigInstruction,
  getJoinGameInstruction,
  getPlayerBoardDecoder,
  PLAYER_BOARD_DISCRIMINATOR,
  type Game,
  type PlayerBoard,
} from '@client/cayed';
import {
  address,
  assertAccountExists,
  type Address,
  type KeyPairSigner,
  type MaybeAccount,
} from '@solana/kit';
import { describe, beforeAll, it, expect } from 'bun:test';
import { connect, type Connection } from 'solana-kite';

// eslint-disable-next-line
const stringify = (object: unknown) => {
  const bigIntReplacer = (key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value;
  return JSON.stringify(object, bigIntReplacer, 2);
};

describe('cayed', () => {
  let authority: KeyPairSigner;
  let player1: KeyPairSigner;
  let player2: KeyPairSigner;

  let configPda: Address;
  let vaultPda: Address;
  let gamePda: Address;
  let player1BoardPda: Address;
  let player2BoardPda: Address;

  let baseConnection: Connection;
  let ephemeralConnection: Connection;

  const gameId = BigInt(Date.now());
  const gridSize = 4;
  const wager = BigInt(1_000_000_000 / 10);

  let getGames: () => Promise<MaybeAccount<Game, string>[]>;
  let getPlayerBoards: () => Promise<MaybeAccount<PlayerBoard, string>[]>;

  const baseUrl = 'http://127.0.0.1:8899';
  const baseWsUrl = 'ws://127.0.0.1:8900';
  const teeUrl = 'http://127.0.0.1:7799';
  const teeWsUrl = 'ws://127.0.0.1:7800';
  // Local validator
  const ER_VALIDATOR = address('mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');

  beforeAll(async () => {
    baseConnection = connect(baseUrl, baseWsUrl);
    ephemeralConnection = connect(teeUrl, teeWsUrl);

    const wallets = await baseConnection.createWallets(3);
    authority = wallets[0]!;
    player1 = wallets[1]!;
    player2 = wallets[2]!;

    const configSeeds = [Buffer.from('config')];
    const configPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      configSeeds
    );
    configPda = configPDAAndBump.pda;

    const vaultSeeds = ['vault'];
    const vaultPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      vaultSeeds
    );
    vaultPda = vaultPDAAndBump.pda;

    const gameSeeds = ['game', gameId];
    const gamePDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      gameSeeds
    );
    gamePda = gamePDAAndBump.pda;

    const player1BoardSeeds = ['player', gameId, player1.address];
    const player1BoardPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      player1BoardSeeds
    );
    player1BoardPda = player1BoardPDAAndBump.pda;

    const player2BoardSeeds = ['player', gameId, player2.address];
    const player2BoardPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      player2BoardSeeds
    );
    player2BoardPda = player2BoardPDAAndBump.pda;

    getPlayerBoards = baseConnection.getAccountsFactory(
      CAYED_PROGRAM_ADDRESS,
      PLAYER_BOARD_DISCRIMINATOR,
      getPlayerBoardDecoder()
    );

    getGames = baseConnection.getAccountsFactory(
      CAYED_PROGRAM_ADDRESS,
      GAME_DISCRIMINATOR,
      getGameDecoder()
    );

    console.log('========= Addresses =========');
    console.log(`Authority: ${authority.address}`);
    console.log(`Player 1: ${player1.address}`);
    console.log(`Player 2: ${player2.address}`);
    console.log(`Config PDA: ${configPda}`);
    console.log(`Vault PDA: ${vaultPda}`);
    console.log(`Game PDA: ${gamePda}`);
    console.log(`Player 1 Board PDA: ${player1BoardPda}`);
    console.log(`Player 2 Board PDA: ${player2BoardPda}`);
    console.log(`Program Address: ${CAYED_PROGRAM_ADDRESS}`);
    console.log(`ER Validator: ${ER_VALIDATOR}`);
    console.log('===============================');
  });

  it('inits config', async () => {
    const ix = getInitConfigInstruction({
      authority: authority,
      config: configPda,
      vault: vaultPda,
      maxGridSize: 10,
      fee: 100, // Basis points: 1%
    });

    const sig = await baseConnection.sendTransactionFromInstructions({
      feePayer: authority,
      instructions: [ix],
      commitment: 'confirmed',
    });

    const getConfigs = baseConnection.getAccountsFactory(
      CAYED_PROGRAM_ADDRESS,
      CONFIG_DISCRIMINATOR,
      getConfigDecoder()
    );
    const configAccounts = await getConfigs();
    expect(configAccounts.length == 1, 'Only one config account should exist');

    const config = configAccounts[0]!;
    assertAccountExists(config);

    expect(
      config.data.authority == authority.address,
      'Config should have correct authority'
    );
    console.log(`Initted config with sig: ${sig}`);
  });

  it('creates game', async () => {
    const ix = getCreateGameInstruction({
      player: player1,
      game: gamePda,
      playerBoard: player1BoardPda,
      config: configPda,
      vault: vaultPda,
      id: gameId,
      gridSize,
      wager,
    });

    const sig = await baseConnection.sendTransactionFromInstructions({
      feePayer: player1,
      instructions: [ix],
      commitment: 'confirmed',
    });

    const gameAccounts = await getGames();
    expect(gameAccounts.length == 1, 'Only one game account should exist');

    const game = gameAccounts[0]!;
    assertAccountExists(game);
    expect(
      game.data.player1 == player1.address,
      'Game account should be initted with correct player1'
    );

    const playerBoardAccounts = await getPlayerBoards();
    expect(
      playerBoardAccounts.length == 1,
      'Only one player board account should exist'
    );

    const player1Board = playerBoardAccounts[0]!;
    expect(player1Board.exists && player1Board.address == player1BoardPda, 'Player 1 board should have been initted');

    console.log(`Game created with sig: ${sig}`);
  });

  it('joins game', async () => {
    const ix = getJoinGameInstruction({
      player: player2,
      game: gamePda,
      playerBoard: player2BoardPda,
      config: configPda,
      vault: vaultPda,
    });

    const sig = await baseConnection.sendTransactionFromInstructions({
      feePayer: player2,
      instructions: [ix],
      commitment: 'confirmed',
    });

    const gameAccounts = await getGames();
    const game = gameAccounts[0]!;

    assertAccountExists(game);
    expect(
      game.data.player2.__option == "Some" && game.data.player2.value == player2.address,
      'Game should be joined with correct player2'
    );

    const playerBoardAccounts = await getPlayerBoards();
    expect(
      playerBoardAccounts.length == 2,
      'Two player board accounts should exist'
    );

    const player2Board = playerBoardAccounts[0]!;
    expect(player2Board.exists && player2Board.address == player2BoardPda, 'Player 1 board should have been initted');

    console.log(`Game created with sig: ${sig}`);
  });
});
