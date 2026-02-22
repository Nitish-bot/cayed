import {
  CAYED_PROGRAM_ADDRESS,
  CONFIG_DISCRIMINATOR,
  GAME_DISCRIMINATOR,
  getConfigDecoder,
  getCreateGameInstruction,
  getCreatePermissionInstruction,
  getDelegatePdaInstruction,
  getGameDecoder,
  getInitConfigInstruction,
  getJoinGameInstruction,
  getPlayerBoardDecoder,
  PLAYER_BOARD_DISCRIMINATOR,
  type Game,
  type PlayerBoard,
} from '@client/cayed';
import {
  AUTHORITY_FLAG,
  createDelegatePermissionInstruction,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  getAuthToken,
  permissionPdaFromAccount,
  TX_LOGS_FLAG,
} from '@magicblock-labs/ephemeral-rollups-kit';
import {
  address,
  assertAccountExists,
  createKeyPairSignerFromPrivateKeyBytes,
  lamports,
  type Address,
  type KeyPairSigner,
  type MaybeAccount,
} from '@solana/kit';
import { describe, beforeAll, it, expect } from 'bun:test';
import { connect, type Connection } from 'solana-kite';
import nacl from 'tweetnacl';
import bs58 from 'bs58'
// eslint-disable-next-line
const stringify = (object: unknown) => {
  const bigIntReplacer = (key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value;
  return JSON.stringify(object, bigIntReplacer, 2);
};

// eslint-disable-next-line
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
const LAMPORTS_PER_SOL = 1_000_000_000;

describe('cayed', () => {
  let authority: KeyPairSigner;
  let player1: KeyPairSigner;
  let player2: KeyPairSigner;
  let player1Bytes: Uint8Array;
  let player2Bytes: Uint8Array;

  let configPda: Address;
  let vaultPda: Address;
  let gamePda: Address;
  let player1BoardPda: Address;
  let player2BoardPda: Address;

  let player1BoardBump: number;

  let baseConnection: Connection;
  let ephemeralConnection: Connection;
  let ephemeralConnectionP1: Connection;
  let ephemeralConnectionP2: Connection;

  const gameId = BigInt(Date.now());
  const gridSize = 4;
  const wager = BigInt(LAMPORTS_PER_SOL / 1_000);

  let getGames: () => Promise<MaybeAccount<Game, string>[]>;
  let getPlayerBoards: () => Promise<MaybeAccount<PlayerBoard, string>[]>;
  let getPlayerBoardsEphemeral: () => Promise<MaybeAccount<PlayerBoard, string>[]>;

  const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8899';
  const baseWsUrl = process.env.BASE_WS_URL || 'ws://127.0.0.1:8900';
  const ephemeralUrl = process.env.EPHEMERAL_URL || 'http://127.0.0.1:7799';
  const ephemeralWsUrl = process.env.EPHEMERAL_WS_URL || 'ws://127.0.0.1:7800';
  
  const validator = process.env.ER_VALIDATOR
  const ER_VALIDATOR = validator && address(validator) || address('mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');

  beforeAll(async () => {
    baseConnection = connect(baseUrl, baseWsUrl);
    authority = await baseConnection.createWallet();
    [player1, player1Bytes] = await createKeypairAndPrivateKeyBytes(baseConnection);
    [player2, player2Bytes] = await createKeypairAndPrivateKeyBytes(baseConnection);

    ephemeralConnection = connect(ephemeralUrl, ephemeralWsUrl);
    if (ephemeralUrl.includes('tee')) {
      const authTokenP1 = await getAuthToken(
        ephemeralUrl,
        player1.address,
        (message: Uint8Array) =>
          Promise.resolve(nacl.sign.detached(message, player1Bytes))
      );
      const authTokenP2 = await getAuthToken(
        ephemeralUrl,
        player2.address,
        (message: Uint8Array) =>
          Promise.resolve(nacl.sign.detached(message, player2Bytes))
      );

      ephemeralConnectionP1 = connect(
        `${ephemeralUrl}?token=${authTokenP1.token}`,
        ephemeralWsUrl
      );
      ephemeralConnectionP2 = connect(
        `${ephemeralUrl}?token=${authTokenP2.token}`,
        ephemeralWsUrl
      );
    }

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
    player1BoardBump = player1BoardPDAAndBump.bump.valueOf();

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
    getPlayerBoardsEphemeral = ephemeralConnection.getAccountsFactory(
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

    await baseConnection.sendTransactionFromInstructions({
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
  });

  it('creates game', async () => {
    const createGameIx = getCreateGameInstruction({
      player: player1,
      game: gamePda,
      playerBoard: player1BoardPda,
      config: configPda,
      vault: vaultPda,
      id: gameId,
      gridSize,
      wager,
    });

    const player1BoardPermission = await permissionPdaFromAccount(player1BoardPda);
    const members = [
      {
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
        pubkey: player1.address,
      },
    ];
    const createPlayer1BoardPermissionIx = getCreatePermissionInstruction({
      payer: player1,
      permissionedAccount: player1BoardPda,
      permission: player1BoardPermission,
      members,
      gameId,
      player: player1.address,
      bump: player1BoardBump
    })

    const delegatePermissionIx = await createDelegatePermissionInstruction({
      payer: player1.address,
      authority: [player1.address, true],
      permissionedAccount: [player1BoardPda, false],
      validator: ER_VALIDATOR,
    })

    const buffer = await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(player1BoardPda, CAYED_PROGRAM_ADDRESS)
    const delegationRecord = await delegationRecordPdaFromDelegatedAccount(player1BoardPda)
    const delegationMetadata = await delegationMetadataPdaFromDelegatedAccount(player1BoardPda)
    
    const delegatePlayer1BoardIx = getDelegatePdaInstruction({
      payer: player1,
      pda: player1BoardPda,
      validator: ER_VALIDATOR,
      bufferPda: buffer,
      delegationRecordPda: delegationRecord,
      delegationMetadataPda: delegationMetadata,
      gameId,
      player: player1.address,
    })

    await baseConnection.sendTransactionFromInstructions({
      feePayer: player1,
      instructions: [
        createGameIx,
        createPlayer1BoardPermissionIx,
        delegatePermissionIx,
        delegatePlayer1BoardIx
      ],
      commitment: 'confirmed',
    });

    const pb = await baseConnection.rpc.getAccountInfo(player1BoardPda).send()
    const pbe = await ephemeralConnection.rpc.getAccountInfo(player1BoardPda).send()
    console.log(pb.value?.owner, pbe.value?.owner)
    const player1Data = pb.value?.data;
    if (!player1Data) {
      throw Error('player1 board not found')
    }
    const player1Bytes = bs58.decode(player1Data)
    const decoder = getPlayerBoardDecoder()
    const player1Board = decoder.decode(player1Bytes)

    expect(player1Board.player == player1.address, 'unmatching player1Board')
  });

  it('joins game', async () => {
    const ix = getJoinGameInstruction({
      player: player2,
      game: gamePda,
      playerBoard: player2BoardPda,
      vault: vaultPda,
    });

    await baseConnection.sendTransactionFromInstructions({
      feePayer: player2,
      instructions: [ix],
      commitment: 'confirmed',
    });

    const gameAccounts = await getGames();
    const game = gameAccounts[0]!;

    assertAccountExists(game);
    expect(
      game.data.player2.__option == 'Some' && game.data.player2.value == player2.address,
      'Game should be joined with correct player2'
    );

    const playerBoardAccounts = await getPlayerBoards();
    expect(playerBoardAccounts.length == 2, 'Two player board accounts should exist');

    const player2Board = playerBoardAccounts[0]!;
    expect(
      player2Board.exists && player2Board.address == player2BoardPda,
      'Player 1 board should have been initted'
    );
  });
});

async function createKeypairAndPrivateKeyBytes(
  connection: Connection
): Promise<[KeyPairSigner, Uint8Array]> {
  // @ts-expect-error generateKey returns keypair for assymetric algos
  const keypair: CryptoKeyPair = await crypto.subtle.generateKey(
    /* algorithm */ { name: 'Ed25519' },
    /* extractable */ true,
    /* usages */ ['sign', 'verify']
  );
  const exportedPrivateKey = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);
  const privateKeyBytes = new Uint8Array(
    exportedPrivateKey,
    exportedPrivateKey.byteLength - 32,
    32
  );
  const keypairSigner = await createKeyPairSignerFromPrivateKeyBytes(privateKeyBytes);
  connection.airdropIfRequired(
    keypairSigner.address,
    lamports(BigInt(LAMPORTS_PER_SOL)),
    lamports(BigInt(LAMPORTS_PER_SOL / 10))
  );
  return [keypairSigner, privateKeyBytes];
}
