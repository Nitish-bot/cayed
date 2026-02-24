import {
  CAYED_PROGRAM_ADDRESS,
  CONFIG_DISCRIMINATOR,
  getConfigDecoder,
  getCreateGameInstruction,
  getCreatePermissionInstruction,
  getDelegatePdaInstruction,
  getGameDecoder,
  getHideShipsInstruction,
  getInitConfigInstruction,
  getJoinGameInstruction,
  getMakeMoveInstruction,
  getPlayerBoardDecoder,
  getRevealWinnerInstruction,
  type ShipCoordinatesArgs,
} from '@client/cayed';
import { accountType } from '@client/cayed/types/accountType';
import {
  Connection as MBConnection,
  AUTHORITY_FLAG,
  createDelegatePermissionInstruction,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  getAuthToken,
  permissionPdaFromAccount,
  waitUntilPermissionActive,
  TX_LOGS_FLAG,
} from '@magicblock-labs/ephemeral-rollups-kit';
import {
  address,
  appendTransactionMessageInstruction,
  assertAccountExists,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { describe, beforeAll, it, expect } from 'bun:test';
import { connect, type Connection } from 'solana-kite';
import nacl from 'tweetnacl';

// eslint-disable-next-line
const stringify = (object: unknown) => {
  const bigIntReplacer = (key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value;
  return JSON.stringify(object, bigIntReplacer, 2);
};

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// sendTransaction + poll confirmation via HTTP (avoids WebSocket)
async function sendAndPoll(
  conn: MBConnection,
  txMsg: Parameters<MBConnection['sendTransaction']>[0],
  signers: Parameters<MBConnection['sendTransaction']>[1],
  opts?: { skipPreflight?: boolean; commitment?: string }
) {
  const sig = await conn.sendTransaction(txMsg, signers, {
    skipPreflight: opts?.skipPreflight ?? true,
  });
  const commitment = opts?.commitment ?? 'confirmed';
  for (let i = 0; i < 60; i++) {
    const { value } = await conn.rpc.getSignatureStatuses([sig]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (
      status?.confirmationStatus === commitment ||
      status?.confirmationStatus === 'finalized'
    ) {
      return sig;
    }
    await sleep(500);
  }
  throw new Error(`Transaction confirmation timeout for ${sig}`);
}

type MoveLogResult = {
  x: number;
  y: number;
  result: 'HIT' | 'MISS';
  gameOver: boolean;
};

const getLastMoveResult = async (
  conn: MBConnection,
  gamePda: Address,
  expectedMoveCount: number
): Promise<MoveLogResult> => {
  const decoder = getGameDecoder();
  // Poll until the game account reflects the expected move count
  for (let i = 0; i < 30; i++) {
    const raw = await conn.rpc.getAccountInfo(gamePda, { encoding: 'base64' }).send();
    if (raw.value) {
      const data = decoder.decode(
        Uint8Array.from(Buffer.from(raw.value.data[0] as string, 'base64'))
      );

      const moveCount = data.moves.length;
      if (moveCount != expectedMoveCount) throw new Error('Move count does not match');

      const last = data.moves[moveCount - 1]!;
      const isCompleted = data.status.__kind == 'Completed';
      return {
        x: last.x,
        y: last.y,
        result: last.isHit ? 'HIT' : 'MISS',
        gameOver: isCompleted,
      };
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for move #${expectedMoveCount} on game account`);
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

  let baseConnection: Connection;
  let ephemeralConnection: MBConnection;
  let ephemeralConnectionP1: MBConnection;
  let ephemeralConnectionP2: MBConnection;

  const gameId = BigInt(Date.now());
  const gridSize = 4;
  const wager = BigInt(LAMPORTS_PER_SOL / 1_000);

  const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8899';
  const baseWsUrl = process.env.BASE_WS_URL || 'ws://127.0.0.1:8900';
  const ephemeralUrl = process.env.EPHEMERAL_URL || 'http://127.0.0.1:7799';
  const ephemeralWsUrl = process.env.EPHEMERAL_WS_URL || 'ws://127.0.0.1:7800';

  const validator = process.env.ER_VALIDATOR;
  const ER_VALIDATOR =
    (validator && address(validator)) ||
    address('mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');

  beforeAll(async () => {
    baseConnection = connect(baseUrl, baseWsUrl);
    // authority = await baseConnection.createWallet();
    // [player1, player1Bytes] = await createKeypairAndPrivateKeyBytes(baseConnection);
    // [player2, player2Bytes] = await createKeypairAndPrivateKeyBytes(baseConnection);
    authority = await baseConnection.loadWalletFromFile();
    player1Bytes = Uint8Array.from(JSON.parse(process.env.P1B!));
    player2Bytes = Uint8Array.from(JSON.parse(process.env.P2B!));
    player1 = await createKeyPairSignerFromBytes(player1Bytes);
    player2 = await createKeyPairSignerFromBytes(player2Bytes);

    ephemeralConnection = await MBConnection.create(ephemeralUrl, ephemeralWsUrl);
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

      ephemeralConnectionP1 = await MBConnection.create(
        `${ephemeralUrl}?token=${authTokenP1.token}`,
        ephemeralWsUrl
      );
      ephemeralConnectionP2 = await MBConnection.create(
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

    const player2BoardSeeds = ['player', gameId, player2.address];
    const player2BoardPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      player2BoardSeeds
    );
    player2BoardPda = player2BoardPDAAndBump.pda;

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
    const pbAccountType = accountType('PlayerBoard', { gameId, player: player1.address });
    const createPlayer1BoardPermissionIx = getCreatePermissionInstruction({
      payer: player1,
      permissionedAccount: player1BoardPda,
      permission: player1BoardPermission,
      members,
      accountType: pbAccountType,
    });

    const delegatePlayerBoardPermissionIx = await createDelegatePermissionInstruction({
      payer: player1.address,
      authority: [player1.address, true],
      permissionedAccount: [player1BoardPda, false],
      validator: ER_VALIDATOR,
    });

    const buffer = await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      player1BoardPda,
      CAYED_PROGRAM_ADDRESS
    );
    const delegationRecord =
      await delegationRecordPdaFromDelegatedAccount(player1BoardPda);
    const delegationMetadata =
      await delegationMetadataPdaFromDelegatedAccount(player1BoardPda);

    const delegatePlayer1BoardIx = getDelegatePdaInstruction({
      payer: player1,
      pda: player1BoardPda,
      validator: ER_VALIDATOR,
      bufferPda: buffer,
      delegationRecordPda: delegationRecord,
      delegationMetadataPda: delegationMetadata,
      accountType: pbAccountType,
    });

    await baseConnection.sendTransactionFromInstructions({
      feePayer: player1,
      instructions: [
        createGameIx,
        createPlayer1BoardPermissionIx,
        delegatePlayerBoardPermissionIx,
        delegatePlayer1BoardIx,
      ],
      commitment: 'confirmed',
    });
  });

  it('joins game', async () => {
    const joinGameIx = getJoinGameInstruction({
      player: player2,
      game: gamePda,
      playerBoard: player2BoardPda,
      vault: vaultPda,
    });

    // Create permission for player2 board
    const player2BoardPermission = await permissionPdaFromAccount(player2BoardPda);
    const members = [
      {
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
        pubkey: player2.address,
      },
    ];
    const p2bAccountType = accountType('PlayerBoard', {
      gameId,
      player: player2.address,
    });
    const createPlayer2BoardPermissionIx = getCreatePermissionInstruction({
      payer: player2,
      permissionedAccount: player2BoardPda,
      permission: player2BoardPermission,
      members,
      accountType: p2bAccountType,
    });

    const delegatePermissionIx = await createDelegatePermissionInstruction({
      payer: player2.address,
      authority: [player2.address, true],
      permissionedAccount: [player2BoardPda, false],
      validator: ER_VALIDATOR,
    });

    const buffer = await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      player2BoardPda,
      CAYED_PROGRAM_ADDRESS
    );
    const delegationRecord =
      await delegationRecordPdaFromDelegatedAccount(player2BoardPda);
    const delegationMetadata =
      await delegationMetadataPdaFromDelegatedAccount(player2BoardPda);

    const delegatePlayer2BoardIx = getDelegatePdaInstruction({
      payer: player2,
      pda: player2BoardPda,
      validator: ER_VALIDATOR,
      bufferPda: buffer,
      delegationRecordPda: delegationRecord,
      delegationMetadataPda: delegationMetadata,
      accountType: p2bAccountType,
    });

    // Delegate game PDA to ER (after join_game sets player_2)
    const gameAccountType = accountType('Game', { gameId });
    const gameBuffer = await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      gamePda,
      CAYED_PROGRAM_ADDRESS
    );
    const gameDelegationRecord = await delegationRecordPdaFromDelegatedAccount(gamePda);
    const gameDelegationMetadata =
      await delegationMetadataPdaFromDelegatedAccount(gamePda);
    const delegateGameIx = getDelegatePdaInstruction({
      payer: player2,
      pda: gamePda,
      validator: ER_VALIDATOR,
      bufferPda: gameBuffer,
      delegationRecordPda: gameDelegationRecord,
      delegationMetadataPda: gameDelegationMetadata,
      accountType: gameAccountType,
    });

    await baseConnection.sendTransactionFromInstructions({
      feePayer: player2,
      instructions: [
        joinGameIx,
        delegateGameIx,
        createPlayer2BoardPermissionIx,
        delegatePermissionIx,
        delegatePlayer2BoardIx,
      ],
      commitment: 'confirmed',
    });
  });

  it('hides ships', async () => {
    // Wait for both boards to be active in ER
    const p1Active = await waitUntilPermissionActive(ephemeralUrl, player1BoardPda);
    console.log(`Player 1 board permission active: ${p1Active}`);
    const p2Active = await waitUntilPermissionActive(ephemeralUrl, player2BoardPda);
    console.log(`Player 2 board permission active: ${p2Active}`);

    const erConnection = ephemeralConnectionP1 ?? ephemeralConnection;

    // Player 1 hides ships on their board
    const p1Ships: ShipCoordinatesArgs[] = [
      { startX: 0, startY: 0, endX: 1, endY: 0 }, // 2-cell ship on row 0
      { startX: 0, startY: 1, endX: 0, endY: 1 }, // 1-cell ship on row 1
    ];
    const hideShipsP1Ix = getHideShipsInstruction({
      player: player1,
      game: gamePda,
      playerBoard: player1BoardPda,
      ships: p1Ships,
    });

    const { value: latestBlockhash } = await erConnection.rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      tx => setTransactionMessageFeePayerSigner(player1, tx),
      tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      tx => appendTransactionMessageInstruction(hideShipsP1Ix, tx)
    );

    await sendAndPoll(erConnection, transactionMessage, [player1.keyPair]);

    // Player 2 hides ships on their board
    const erConnection2 = ephemeralConnectionP2 ?? ephemeralConnection;
    const p2Ships: ShipCoordinatesArgs[] = [
      { startX: 2, startY: 0, endX: 3, endY: 0 }, // 2-cell ship on row 0
      { startX: 1, startY: 1, endX: 1, endY: 1 }, // 1-cell ship on row 1
    ];
    const hideShipsP2Ix = getHideShipsInstruction({
      player: player2,
      game: gamePda,
      playerBoard: player2BoardPda,
      ships: p2Ships,
    });

    const { value: latestBlockhash2 } = await erConnection.rpc
      .getLatestBlockhash()
      .send();
    const transactionMessage2 = pipe(
      createTransactionMessage({ version: 0 }),
      tx => setTransactionMessageFeePayerSigner(player2, tx),
      tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash2, tx),
      tx => appendTransactionMessageInstruction(hideShipsP2Ix, tx)
    );

    await sendAndPoll(erConnection2, transactionMessage2, [player2.keyPair]);
  });

  it('players can see own board but not opponent board', async () => {
    const erConnection1 = ephemeralConnectionP1 ?? ephemeralConnection;
    const erConnection2 = ephemeralConnectionP2 ?? ephemeralConnection;

    // Player 1 CAN see their own board
    const p1OwnBoard = await erConnection1.rpc
      .getAccountInfo(player1BoardPda, { encoding: 'base64' })
      .send();
    if (p1OwnBoard.value == null) {
      throw new Error('❌ Player 1 cannot see their own board!');
    }

    // Player 2 CAN see their own board
    const p2OwnBoard = await erConnection2.rpc
      .getAccountInfo(player2BoardPda, { encoding: 'base64' })
      .send();
    if (p2OwnBoard.value == null) {
      throw new Error('❌ Player 2 cannot see their own board!');
    }

    // Player 2 CANNOT see Player 1's board
    try {
      const sneak1 = await erConnection2.rpc
        .getAccountInfo(player1BoardPda, { encoding: 'base64' })
        .send();
      if (sneak1.value !== null) {
        throw new Error('❌ Player 2 was able to read Player 1 board!');
      }
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.message?.includes('Player 2 was able to read')) throw e;
    }

    // Player 1 CANNOT see Player 2's board
    try {
      const sneak2 = await erConnection1.rpc
        .getAccountInfo(player2BoardPda, { encoding: 'base64' })
        .send();
      if (sneak2.value !== null) {
        throw new Error('❌ Player 1 was able to read Player 2 board!');
      }
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.message?.includes('Player 1 was able to read')) throw e;
    }
  });

  it('makes moves and sinks all ships', async () => {
    console.log('Playing game, this way take time...');
    const erConnection1 = ephemeralConnectionP1 ?? ephemeralConnection;
    const erConnection2 = ephemeralConnectionP2 ?? ephemeralConnection;

    // Determine who goes first: if gameId is even, player1 goes first
    const player1First = gameId % 2n === 0n;

    let moveCount = 0;

    // Player 2's ships: (2,0),(3,0),(1,1) → 3 cells to sink
    // Player 1's ships: (0,0),(1,0),(0,1) → 3 cells to sink
    // We'll attack all of player 2's ships to make player 1 the winner

    const attacksOnP2Board = [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 1, y: 1 },
    ];
    const attacksOnP1Board = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];

    // Interleave moves based on turn order
    let p1AttackIdx = 0;
    let p2AttackIdx = 0;
    let isP1Turn = player1First;

    // Player 1 attacks player 2's board; Player 2 attacks player 1's board
    // We need player 1 to finish sinking all of player 2's ships
    while (p1AttackIdx < attacksOnP2Board.length) {
      if (isP1Turn) {
        const attack = attacksOnP2Board[p1AttackIdx]!;
        const ix = getMakeMoveInstruction({
          player: player1,
          opponent: player2.address,
          game: gamePda,
          playerBoard: player1BoardPda,
          opponentBoard: player2BoardPda,
          x: attack.x,
          y: attack.y,
        });

        const { value: bhash } = await erConnection1.rpc.getLatestBlockhash().send();
        const txMsg = pipe(
          createTransactionMessage({ version: 0 }),
          tx => setTransactionMessageFeePayerSigner(player1, tx),
          tx => setTransactionMessageLifetimeUsingBlockhash(bhash, tx),
          tx => appendTransactionMessageInstruction(ix, tx)
        );

        await sendAndPoll(erConnection1, txMsg, [player1.keyPair]);
        moveCount++;
        const move = await getLastMoveResult(erConnection1, gamePda, moveCount);
        expect(move.x).toBe(attack.x);
        expect(move.y).toBe(attack.y);
        expect(move.result).toBe('HIT');
        p1AttackIdx++;
        isP1Turn = false;
      } else {
        if (p2AttackIdx < attacksOnP1Board.length) {
          const attack = attacksOnP1Board[p2AttackIdx]!;
          const ix = getMakeMoveInstruction({
            player: player2,
            opponent: player1.address,
            game: gamePda,
            playerBoard: player2BoardPda,
            opponentBoard: player1BoardPda,
            x: attack.x,
            y: attack.y,
          });

          const { value: bhash } = await erConnection2.rpc.getLatestBlockhash().send();
          const txMsg = pipe(
            createTransactionMessage({ version: 0 }),
            tx => setTransactionMessageFeePayerSigner(player2, tx),
            tx => setTransactionMessageLifetimeUsingBlockhash(bhash, tx),
            tx => appendTransactionMessageInstruction(ix, tx)
          );

          await sendAndPoll(erConnection2, txMsg, [player2.keyPair]);
          moveCount++;
          const move = await getLastMoveResult(erConnection2, gamePda, moveCount);
          expect(move.x).toBe(attack.x);
          expect(move.y).toBe(attack.y);
          expect(move.result).toBe('HIT');
          p2AttackIdx++;
        } else {
          // Player 2 has no more attacks but still needs to take a turn
          // Attack a non-ship cell
          const ix = getMakeMoveInstruction({
            player: player2,
            opponent: player1.address,
            game: gamePda,
            playerBoard: player2BoardPda,
            opponentBoard: player1BoardPda,
            x: 3,
            y: 1,
          });

          const { value: bhash } = await erConnection2.rpc.getLatestBlockhash().send();
          const txMsg = pipe(
            createTransactionMessage({ version: 0 }),
            tx => setTransactionMessageFeePayerSigner(player2, tx),
            tx => setTransactionMessageLifetimeUsingBlockhash(bhash, tx),
            tx => appendTransactionMessageInstruction(ix, tx)
          );

          await sendAndPoll(erConnection2, txMsg, [player2.keyPair]);
          moveCount++;
          const move = await getLastMoveResult(erConnection2, gamePda, moveCount);
          expect(move.x).toBe(3);
          expect(move.y).toBe(1);
          expect(move.result).toBe('MISS');
        }
        isP1Turn = true;
      }
    }

    const decoder = getGameDecoder();
    const gameRaw = await baseConnection.rpc
      .getAccountInfo(gamePda, { encoding: 'base64' })
      .send();
    const gameData = decoder.decode(
      Uint8Array.from(Buffer.from(gameRaw.value!.data[0], 'base64'))
    );
    expect(
      gameData.status.__kind == 'Completed' && gameData.status.winner == player1.address,
      'Game status didnt match'
    );
  });

  it('reveals winner', async () => {
    const erConnection = ephemeralConnectionP1 ?? ephemeralConnection;

    const permission1 = await permissionPdaFromAccount(player1BoardPda);
    const permission2 = await permissionPdaFromAccount(player2BoardPda);

    const ix = getRevealWinnerInstruction({
      game: gamePda,
      player1Board: player1BoardPda,
      player2Board: player2BoardPda,
      permission1,
      permission2,
      payer: player1,
    });

    const { value: bhash } = await erConnection.rpc.getLatestBlockhash().send();
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      tx => setTransactionMessageFeePayerSigner(player1, tx),
      tx => setTransactionMessageLifetimeUsingBlockhash(bhash, tx),
      tx => appendTransactionMessageInstruction(ix, tx)
    );

    await sendAndPoll(erConnection, txMsg, [player1.keyPair]);

    await sleep(5000);

    // Read the player boards on base layer and verify contents
    const decoder = getPlayerBoardDecoder();

    const p1Raw = await baseConnection.rpc
      .getAccountInfo(player1BoardPda, { encoding: 'base64' })
      .send();
    const p1Data = decoder.decode(
      Uint8Array.from(Buffer.from(p1Raw.value!.data[0], 'base64'))
    );
    expect(p1Data.player).toBe(player1.address);
    expect(p1Data.gameId).toBe(gameId);
    expect(p1Data.shipCoordinates.length).toBe(2);
    // P1 ships: (0,0)-(1,0) and (0,1)-(0,1)
    // P2 attacked: (0,0), (1,0), (3,1)
    const p1Hits = p1Data.hitsBitmap.toString(2).split('1').length - 1;
    expect(p1Hits).toBeGreaterThanOrEqual(2);

    const p2Raw = await baseConnection.rpc
      .getAccountInfo(player2BoardPda, { encoding: 'base64' })
      .send();
    const p2Data = decoder.decode(
      Uint8Array.from(Buffer.from(p2Raw.value!.data[0], 'base64'))
    );
    expect(p2Data.player).toBe(player2.address);
    expect(p2Data.gameId).toBe(gameId);
    expect(p2Data.shipCoordinates.length).toBe(2);
    // P1 attacked: (2,0), (3,0), (1,1) — all 3 cells of P2's ships sunk
    const p2Hits = p2Data.hitsBitmap.toString(2).split('1').length - 1;
    expect(p2Hits).toBe(3);
  });
});
