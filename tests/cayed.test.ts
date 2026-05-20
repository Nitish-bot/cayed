import { readFileSync } from 'fs';
import { homedir } from 'os';

import * as anchor from '@coral-xyz/anchor';
import {
  AUTHORITY_FLAG,
  createDelegatePermissionInstruction,
  getAuthToken,
  permissionPdaFromAccount,
  TX_LOGS_FLAG,
  waitUntilPermissionActive,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import { describe, beforeAll, it, expect } from 'bun:test';
import nacl from 'tweetnacl';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function sendAndConfirmER(
  conn: Connection,
  feePayer: Keypair,
  ix: anchor.web3.TransactionInstruction,
  retries = 3
) {
  let lastErr: unknown;
  for (let a = 0; a < retries; a++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction().add(ix);
      tx.feePayer = feePayer.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(feePayer);
      const sig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 0,
      });
      const res = await conn.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      );
      if (res.value.err) throw new Error(JSON.stringify(res.value.err));
      return sig;
    } catch (e: unknown) {
      lastErr = e;
      const msg = String(e);
      if (
        a < retries - 1 &&
        (msg.includes('InvalidWritableAccount') || msg.includes('AccountNotFound'))
      ) {
        await sleep(2000 * (a + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error('sendAndConfirmER exhausted');
}

describe('cayed', () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let authorityKp: Keypair;
  let player1: Keypair;
  let player2: Keypair;
  let otherAuth: Keypair;

  let configPda: PublicKey;
  let vaultPda: PublicKey;

  let baseConn: Connection;
  let erConn: Connection;
  let erConnP1: Connection;
  let erConnP2: Connection;

  const baseUrl = process.env.BASE_ENDPOINT || 'http://127.0.0.1:8899';
  const baseWs = process.env.BASE_WS_ENDPOINT || 'ws://127.0.0.1:8900';
  const erUrl = process.env.EPHEMERAL_ENDPOINT || 'http://127.0.0.1:7799';
  const erWs = process.env.EPHEMERAL_WS_ENDPOINT || 'ws://127.0.0.1:7800';

  const ER_VALIDATOR = new PublicKey(
    process.env.ER_VALIDATOR || 'mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev'
  );

  beforeAll(async () => {
    baseConn = new Connection(baseUrl, { wsEndpoint: baseWs, commitment: 'confirmed' });
    erConn = new Connection(erUrl, { wsEndpoint: erWs, commitment: 'confirmed' });

    const walletPath = process.env.ANCHOR_WALLET || `${homedir()}/.config/solana/id.json`;
    authorityKp = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(walletPath, 'utf-8')))
    );

    const p1b = Uint8Array.from(JSON.parse(process.env.P1B!));
    const p2b = Uint8Array.from(JSON.parse(process.env.P2B!));
    player1 = Keypair.fromSecretKey(p1b);
    player2 = Keypair.fromSecretKey(p2b);
    otherAuth = Keypair.generate();

    provider = new anchor.AnchorProvider(baseConn, new anchor.Wallet(authorityKp), {
      commitment: 'confirmed',
    });

    const idl = JSON.parse(readFileSync('target/idl/cayed.json', 'utf-8'));
    program = new anchor.Program(idl, provider);

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      program.programId
    );

    if (erUrl.includes('tee')) {
      const clean = erUrl.replace(/\/$/, '');
      const sign = (msg: Uint8Array, sk: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(msg, sk));
      const t1 = await getAuthToken(clean, player1.publicKey, m => sign(m, p1b));
      const t2 = await getAuthToken(clean, player2.publicKey, m => sign(m, p2b));
      erConnP1 = new Connection(`${clean}?token=${t1.token}`, {
        wsEndpoint: `${erWs}?token=${t1.token}`,
        commitment: 'confirmed',
      });
      erConnP2 = new Connection(`${clean}?token=${t2.token}`, {
        wsEndpoint: `${erWs}?token=${t2.token}`,
        commitment: 'confirmed',
      });
    } else {
      erConnP1 = erConn;
      erConnP2 = erConn;
    }
  });

  // ─────────── Config ───────────

  it('inits config', async () => {
    const tx = await program.methods
      .initConfig(10, 100)
      .accounts({
        authority: authorityKp.publicKey,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = authorityKp.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [authorityKp], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    const raw = await baseConn.getAccountInfo(configPda);
    const c = program.coder.accounts.decode('config', raw!.data);
    expect(c.authority.toBase58()).toBe(authorityKp.publicKey.toBase58());
    expect(c.maxGridSize).toBe(10);
  });

  it('rejects re-init by different authority', async () => {
    const tx = await program.methods
      .initConfig(6, 50)
      .accounts({
        authority: otherAuth.publicKey,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = otherAuth.publicKey;
    try {
      await sendAndConfirmTransaction(baseConn, tx, [otherAuth], {
        commitment: 'confirmed',
      });
      throw new Error('should have failed');
    } catch {
      // expected — Unauthorized
    }
  });

  // ─────────── Create Game ───────────

  it('creates game with permission + delegate', async () => {
    const gid = new anchor.BN(Date.now());
    const id = gid.toArrayLike(Buffer, 'le', 8);
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    const [p1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );

    const permAddr = permissionPdaFromAccount(p1Pda);

    const createIx = await program.methods
      .createGame(gid, 4, new anchor.BN(0))
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const permIx = await program.methods
      .createPermission({ playerBoard: { gameId: gid, player: player1.publicKey } }, [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player1.publicKey },
      ])
      .accounts({
        payer: player1.publicKey,
        permissionedAccount: p1Pda,
        permission: permAddr,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delPerm = createDelegatePermissionInstruction({
      payer: player1.publicKey,
      authority: [player1.publicKey, true],
      permissionedAccount: [p1Pda, false],
      validator: ER_VALIDATOR,
    });

    const delPdaIx = await program.methods
      .delegatePda({ playerBoard: { gameId: gid, player: player1.publicKey } })
      .accounts({ payer: player1.publicKey, pda: p1Pda, validator: ER_VALIDATOR })
      .instruction();

    const tx = new Transaction().add(createIx, permIx, delPerm, delPdaIx);
    tx.feePayer = player1.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player1], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    const raw = await baseConn.getAccountInfo(gamePda);
    const g = program.coder.accounts.decode('game', raw!.data);
    expect(g.status).toHaveProperty('awaitingPlayerTwo');

    const ok = await waitUntilPermissionActive(erUrl, p1Pda);
    expect(ok).toBe(true);
  });

  it('rejects wager below minimum', async () => {
    const gid = new anchor.BN(Date.now());
    const id = gid.toArrayLike(Buffer, 'le', 8);
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    const [p1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );
    const tx = await program.methods
      .createGame(gid, 4, new anchor.BN(50_000))
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    try {
      await sendAndConfirmTransaction(baseConn, tx, [player1], {
        skipPreflight: true,
        commitment: 'confirmed',
      });
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  it('rejects grid > config max', async () => {
    const gid = new anchor.BN(Date.now());
    const id = gid.toArrayLike(Buffer, 'le', 8);
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    const [p1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );
    const tx = await program.methods
      .createGame(gid, 12, new anchor.BN(0))
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    try {
      await sendAndConfirmTransaction(baseConn, tx, [player1], {
        skipPreflight: true,
        commitment: 'confirmed',
      });
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  // ─────────── Join Game ───────────

  it('joins game + permission + delegate', async () => {
    const gid = new anchor.BN(Date.now());
    const id = gid.toArrayLike(Buffer, 'le', 8);
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    const [p1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );
    const [p2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player2.publicKey.toBuffer()],
      program.programId
    );

    // create
    let tx = await program.methods
      .createGame(gid, 4, new anchor.BN(0))
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player1], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    // join + permission + delegate game + delegate board
    const permAddr = permissionPdaFromAccount(p2Pda);
    const joinIx = await program.methods
      .joinGame()
      .accounts({
        player: player2.publicKey,
        game: gamePda,
        playerBoard: p2Pda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const permIx = await program.methods
      .createPermission({ playerBoard: { gameId: gid, player: player2.publicKey } }, [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player2.publicKey },
      ])
      .accounts({
        payer: player2.publicKey,
        permissionedAccount: p2Pda,
        permission: permAddr,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delPerm = createDelegatePermissionInstruction({
      payer: player2.publicKey,
      authority: [player2.publicKey, true],
      permissionedAccount: [p2Pda, false],
      validator: ER_VALIDATOR,
    });

    const delGameIx = await program.methods
      .delegatePda({ game: { gameId: gid } })
      .accounts({ payer: player2.publicKey, pda: gamePda, validator: ER_VALIDATOR })
      .instruction();

    const delPdaIx = await program.methods
      .delegatePda({ playerBoard: { gameId: gid, player: player2.publicKey } })
      .accounts({ payer: player2.publicKey, pda: p2Pda, validator: ER_VALIDATOR })
      .instruction();

    tx = new Transaction().add(joinIx, delGameIx, permIx, delPerm, delPdaIx);
    tx.feePayer = player2.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player2], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    const raw = await baseConn.getAccountInfo(gamePda);
    const g = program.coder.accounts.decode('game', raw!.data);
    expect(g.status).toHaveProperty('hidingShips');
    expect(g.player2?.toBase58()).toBe(player2.publicKey.toBase58());

    const ok = await waitUntilPermissionActive(erUrl, p2Pda);
    expect(ok).toBe(true);
  });

  it('rejects self-join', async () => {
    const gid = new anchor.BN(Date.now());
    const id = gid.toArrayLike(Buffer, 'le', 8);
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    const [p1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );

    let tx = await program.methods
      .createGame(gid, 4, new anchor.BN(0))
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player1], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    tx = await program.methods
      .joinGame()
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    try {
      await sendAndConfirmTransaction(baseConn, tx, [player1], {
        skipPreflight: true,
        commitment: 'confirmed',
      });
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  it('rejects 3rd player', async () => {
    const gid = new anchor.BN(Date.now());
    const id = gid.toArrayLike(Buffer, 'le', 8);
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    const [p1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );
    const [p2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player2.publicKey.toBuffer()],
      program.programId
    );

    let tx = await program.methods
      .createGame(gid, 4, new anchor.BN(0))
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player1], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    tx = await program.methods
      .joinGame()
      .accounts({
        player: player2.publicKey,
        game: gamePda,
        playerBoard: p2Pda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = player2.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player2], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    const p3 = Keypair.generate();
    const [p3Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, p3.publicKey.toBuffer()],
      program.programId
    );
    tx = await program.methods
      .joinGame()
      .accounts({
        player: p3.publicKey,
        game: gamePda,
        playerBoard: p3Pda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = p3.publicKey;
    try {
      await sendAndConfirmTransaction(baseConn, tx, [p3], {
        commitment: 'confirmed',
      });
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  // ─────────── Hide Ships ───────────

  const P1_SHIPS = [
    { startX: 0, startY: 0, endX: 1, endY: 0 },
    { startX: 0, startY: 1, endX: 0, endY: 1 },
  ];
  const P2_SHIPS = [
    { startX: 2, startY: 0, endX: 3, endY: 0 },
    { startX: 1, startY: 1, endX: 1, endY: 1 },
  ];

  async function createAndJoin(gid: anchor.BN) {
    const id = gid.toArrayLike(Buffer, 'le', 8);
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    const [p1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );
    const [p2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player2.publicKey.toBuffer()],
      program.programId
    );

    const perm1 = permissionPdaFromAccount(p1Pda);
    const perm2 = permissionPdaFromAccount(p2Pda);

    // create game + permission + delegate P1 board
    const createIx = await program.methods
      .createGame(gid, 4, new anchor.BN(0))
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const perm1Ix = await program.methods
      .createPermission({ playerBoard: { gameId: gid, player: player1.publicKey } }, [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player1.publicKey },
      ])
      .accounts({
        payer: player1.publicKey,
        permissionedAccount: p1Pda,
        permission: perm1,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delPerm1 = createDelegatePermissionInstruction({
      payer: player1.publicKey,
      authority: [player1.publicKey, true],
      permissionedAccount: [p1Pda, false],
      validator: ER_VALIDATOR,
    });

    const delPda1 = await program.methods
      .delegatePda({ playerBoard: { gameId: gid, player: player1.publicKey } })
      .accounts({ payer: player1.publicKey, pda: p1Pda, validator: ER_VALIDATOR })
      .instruction();

    let tx = new Transaction().add(createIx, perm1Ix, delPerm1, delPda1);
    tx.feePayer = player1.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player1], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    await waitUntilPermissionActive(erUrl, p1Pda);

    // join + permission + delegate P2 board + game
    const joinIx = await program.methods
      .joinGame()
      .accounts({
        player: player2.publicKey,
        game: gamePda,
        playerBoard: p2Pda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const perm2Ix = await program.methods
      .createPermission({ playerBoard: { gameId: gid, player: player2.publicKey } }, [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player2.publicKey },
      ])
      .accounts({
        payer: player2.publicKey,
        permissionedAccount: p2Pda,
        permission: perm2,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delPerm2 = createDelegatePermissionInstruction({
      payer: player2.publicKey,
      authority: [player2.publicKey, true],
      permissionedAccount: [p2Pda, false],
      validator: ER_VALIDATOR,
    });

    const delGameIx = await program.methods
      .delegatePda({ game: { gameId: gid } })
      .accounts({ payer: player2.publicKey, pda: gamePda, validator: ER_VALIDATOR })
      .instruction();

    const delPda2 = await program.methods
      .delegatePda({ playerBoard: { gameId: gid, player: player2.publicKey } })
      .accounts({ payer: player2.publicKey, pda: p2Pda, validator: ER_VALIDATOR })
      .instruction();

    tx = new Transaction().add(joinIx, delGameIx, perm2Ix, delPerm2, delPda2);
    tx.feePayer = player2.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player2], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    await waitUntilPermissionActive(erUrl, p2Pda);

    return { gamePda, p1Pda, p2Pda };
  }

  it('hides ships on both boards', async () => {
    const gid = new anchor.BN(Date.now());
    const { gamePda, p1Pda, p2Pda } = await createAndJoin(gid);

    const ix1 = await program.methods
      .hideShips(P1_SHIPS)
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
      })
      .instruction();
    await sendAndConfirmER(erConnP1, player1, ix1);

    const ix2 = await program.methods
      .hideShips(P2_SHIPS)
      .accounts({
        player: player2.publicKey,
        game: gamePda,
        playerBoard: p2Pda,
      })
      .instruction();
    await sendAndConfirmER(erConnP2, player2, ix2);

    const b1 = program.coder.accounts.decode(
      'playerBoard',
      (await erConnP1.getAccountInfo(p1Pda))!.data
    );
    const b2 = program.coder.accounts.decode(
      'playerBoard',
      (await erConnP2.getAccountInfo(p2Pda))!.data
    );
    expect(b1.shipCoordinates.length).toBe(2);
    expect(b2.shipCoordinates.length).toBe(2);
  });

  it('rejects wrong ship count', async () => {
    const gid = new anchor.BN(Date.now());
    const { gamePda, p1Pda } = await createAndJoin(gid);
    const ix = await program.methods
      .hideShips([{ startX: 0, startY: 0, endX: 1, endY: 0 }])
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
      })
      .instruction();
    try {
      await sendAndConfirmER(erConnP1, player1, ix);
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  it('rejects diagonal ship', async () => {
    const gid = new anchor.BN(Date.now());
    const { gamePda, p1Pda } = await createAndJoin(gid);
    const ix = await program.methods
      .hideShips([
        { startX: 0, startY: 0, endX: 1, endY: 1 },
        { startX: 2, startY: 0, endX: 3, endY: 0 },
      ])
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
      })
      .instruction();
    try {
      await sendAndConfirmER(erConnP1, player1, ix);
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  it('rejects out of bounds', async () => {
    const gid = new anchor.BN(Date.now());
    const { gamePda, p1Pda } = await createAndJoin(gid);
    const ix = await program.methods
      .hideShips([
        { startX: 0, startY: 0, endX: 1, endY: 0 },
        { startX: 0, startY: 2, endX: 0, endY: 2 },
      ])
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
      })
      .instruction();
    try {
      await sendAndConfirmER(erConnP1, player1, ix);
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  it('rejects overlapping ships', async () => {
    const gid = new anchor.BN(Date.now());
    const { gamePda, p1Pda } = await createAndJoin(gid);
    const ix = await program.methods
      .hideShips([
        { startX: 0, startY: 0, endX: 1, endY: 0 },
        { startX: 1, startY: 0, endX: 2, endY: 0 },
      ])
      .accounts({
        player: player1.publicKey,
        game: gamePda,
        playerBoard: p1Pda,
      })
      .instruction();
    try {
      await sendAndConfirmER(erConnP1, player1, ix);
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  // ─────────── Privacy ───────────

  it('player sees own board but not opponent', async () => {
    const gid = new anchor.BN(Date.now());
    const { gamePda, p1Pda } = await createAndJoin(gid);

    await sendAndConfirmER(
      erConnP1,
      player1,
      await program.methods
        .hideShips(P1_SHIPS)
        .accounts({
          player: player1.publicKey,
          game: gamePda,
          playerBoard: p1Pda,
        })
        .instruction()
    );

    const own = await erConnP1.getAccountInfo(p1Pda);
    expect(own).not.toBeNull();

    const sneak = await erConnP2.getAccountInfo(p1Pda);
    expect(sneak).toBeNull();
  });

  // ─────────── Full Game: Play + Reveal ───────────

  let playGamePda: PublicKey;
  let playP1Pda: PublicKey;
  let playP2Pda: PublicKey;

  it('sets up game for playthrough', async () => {
    let gid = new anchor.BN(Date.now());
    if (gid.toNumber() % 2 !== 0) gid = new anchor.BN(gid.toNumber() + 1); // P1 first

    const id = gid.toArrayLike(Buffer, 'le', 8);
    [playGamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), id],
      program.programId
    );
    [playP1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player1.publicKey.toBuffer()],
      program.programId
    );
    [playP2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), id, player2.publicKey.toBuffer()],
      program.programId
    );

    const perm1 = permissionPdaFromAccount(playP1Pda);
    const perm2 = permissionPdaFromAccount(playP2Pda);

    // create + permission + delegate P1 board
    const createIx = await program.methods
      .createGame(gid, 4, new anchor.BN(0))
      .accounts({
        player: player1.publicKey,
        game: playGamePda,
        playerBoard: playP1Pda,
        config: configPda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const perm1Ix = await program.methods
      .createPermission({ playerBoard: { gameId: gid, player: player1.publicKey } }, [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player1.publicKey },
      ])
      .accounts({
        payer: player1.publicKey,
        permissionedAccount: playP1Pda,
        permission: perm1,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delPerm1 = createDelegatePermissionInstruction({
      payer: player1.publicKey,
      authority: [player1.publicKey, true],
      permissionedAccount: [playP1Pda, false],
      validator: ER_VALIDATOR,
    });

    const delPda1 = await program.methods
      .delegatePda({ playerBoard: { gameId: gid, player: player1.publicKey } })
      .accounts({ payer: player1.publicKey, pda: playP1Pda, validator: ER_VALIDATOR })
      .instruction();

    let tx = new Transaction().add(createIx, perm1Ix, delPerm1, delPda1);
    tx.feePayer = player1.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player1], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    await waitUntilPermissionActive(erUrl, playP1Pda);

    // join + permission + delegate P2 board + game
    const joinIx = await program.methods
      .joinGame()
      .accounts({
        player: player2.publicKey,
        game: playGamePda,
        playerBoard: playP2Pda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const perm2Ix = await program.methods
      .createPermission({ playerBoard: { gameId: gid, player: player2.publicKey } }, [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player2.publicKey },
      ])
      .accounts({
        payer: player2.publicKey,
        permissionedAccount: playP2Pda,
        permission: perm2,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delPerm2 = createDelegatePermissionInstruction({
      payer: player2.publicKey,
      authority: [player2.publicKey, true],
      permissionedAccount: [playP2Pda, false],
      validator: ER_VALIDATOR,
    });

    const delGameIx = await program.methods
      .delegatePda({ game: { gameId: gid } })
      .accounts({ payer: player2.publicKey, pda: playGamePda, validator: ER_VALIDATOR })
      .instruction();

    const delPda2 = await program.methods
      .delegatePda({ playerBoard: { gameId: gid, player: player2.publicKey } })
      .accounts({ payer: player2.publicKey, pda: playP2Pda, validator: ER_VALIDATOR })
      .instruction();

    tx = new Transaction().add(joinIx, delGameIx, perm2Ix, delPerm2, delPda2);
    tx.feePayer = player2.publicKey;
    await sendAndConfirmTransaction(baseConn, tx, [player2], {
      skipPreflight: true,
      commitment: 'confirmed',
    });

    await waitUntilPermissionActive(erUrl, playP2Pda);

    // hide ships
    await sendAndConfirmER(
      erConnP1,
      player1,
      await program.methods
        .hideShips(P1_SHIPS)
        .accounts({
          player: player1.publicKey,
          game: playGamePda,
          playerBoard: playP1Pda,
        })
        .instruction()
    );

    await sendAndConfirmER(
      erConnP2,
      player2,
      await program.methods
        .hideShips(P2_SHIPS)
        .accounts({
          player: player2.publicKey,
          game: playGamePda,
          playerBoard: playP2Pda,
        })
        .instruction()
    );
  });

  it('rejects wrong turn', async () => {
    const ix = await program.methods
      .makeMove(0, 0)
      .accounts({
        player: player2.publicKey,
        opponent: player1.publicKey,
        game: playGamePda,
        playerBoard: playP2Pda,
        opponentBoard: playP1Pda,
      })
      .instruction();
    try {
      await sendAndConfirmER(erConnP2, player2, ix);
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  it('rejects out of bounds move', async () => {
    const ix = await program.methods
      .makeMove(4, 0)
      .accounts({
        player: player1.publicKey,
        opponent: player2.publicKey,
        game: playGamePda,
        playerBoard: playP1Pda,
        opponentBoard: playP2Pda,
      })
      .instruction();
    try {
      await sendAndConfirmER(erConnP1, player1, ix);
      throw new Error('should have failed');
    } catch {
      // expected
    }
  });

  it('P1 wins, reveals winner', async () => {
    // P2 ships at (2,0)(3,0) and (1,1). P1 attacks all 3.
    const hits = [
      [2, 0],
      [3, 0],
      [1, 1],
    ];
    const misses = [
      [0, 1],
      [0, 0],
    ];

    for (let i = 0; i < hits.length; i++) {
      await sendAndConfirmER(
        erConnP1,
        player1,
        await program.methods
          .makeMove(hits[i]![0]!, hits[i]![1]!)
          .accounts({
            player: player1.publicKey,
            opponent: player2.publicKey,
            game: playGamePda,
            playerBoard: playP1Pda,
            opponentBoard: playP2Pda,
          })
          .instruction()
      );
      if (i < misses.length) {
        await sendAndConfirmER(
          erConnP2,
          player2,
          await program.methods
            .makeMove(misses[i]![0]!, misses[i]![1]!)
            .accounts({
              player: player2.publicKey,
              opponent: player1.publicKey,
              game: playGamePda,
              playerBoard: playP2Pda,
              opponentBoard: playP1Pda,
            })
            .instruction()
        );
      }
    }

    const raw = await erConnP1.getAccountInfo(playGamePda);
    const g = program.coder.accounts.decode('game', raw!.data);
    expect(g.status).toHaveProperty('completed');
    expect(g.status.completed.winner.toBase58()).toBe(player1.publicKey.toBase58());

    // reveal
    const perm1 = permissionPdaFromAccount(playP1Pda);
    const perm2 = permissionPdaFromAccount(playP2Pda);

    await sendAndConfirmER(
      erConnP1,
      player1,
      await program.methods
        .revealWinner()
        .accounts({
          game: playGamePda,
          player1Board: playP1Pda,
          player2Board: playP2Pda,
          permission1: perm1,
          permission2: perm2,
          payer: player1.publicKey,
        })
        .instruction()
    );
    await sleep(5000);

    // boards public
    const p1r = await baseConn.getAccountInfo(playP1Pda);
    const p1 = program.coder.accounts.decode('playerBoard', p1r!.data);
    expect(p1.shipCoordinates.length).toBe(2);

    const p2r = await baseConn.getAccountInfo(playP2Pda);
    const p2 = program.coder.accounts.decode('playerBoard', p2r!.data);
    expect(p2.shipCoordinates.length).toBe(2);

    const gr = await baseConn.getAccountInfo(playGamePda);
    const g2 = program.coder.accounts.decode('game', gr!.data);
    expect(g2.status).toHaveProperty('winnerRevealed');
    expect(g2.status.winnerRevealed.winner.toBase58()).toBe(player1.publicKey.toBase58());
  });
});
