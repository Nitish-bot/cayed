import {
  AccountRole,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Blockhash,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';

import type { Connection } from 'solana-kite';

const CONFIRM_TIMEOUT_MS = 30_000;
const CONFIRM_POLL_MS = 500;

type BlockhashLifetime = {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
};

/** Writable accounts referenced by the instruction list. */
function getWritableAccountsFromInstructions(instructions: Instruction[]): string[] {
  const accounts = new Set<string>();
  for (const ix of instructions) {
    for (const account of ix.accounts ?? []) {
      if (
        account.role === AccountRole.WRITABLE ||
        account.role === AccountRole.WRITABLE_SIGNER
      ) {
        accounts.add(String(account.address));
      }
    }
  }
  return [...accounts];
}

/** MagicBlock ER / router endpoints expose getBlockhashForAccounts. */
async function isMagicBlockRouter(rpcHttpUrl: string): Promise<boolean> {
  const url = rpcHttpUrl.replace(/\/$/, '');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBlockhashForAccounts',
        params: [[]],
      }),
    });
    const json = (await res.json()) as {
      result?: { blockhash?: string; lastValidBlockHeight?: number };
    };
    return typeof json.result?.blockhash === 'string' && json.result.blockhash.length > 0;
  } catch {
    return false;
  }
}

async function getBlockhashForAccounts(
  rpcHttpUrl: string,
  writableAccounts: string[]
): Promise<BlockhashLifetime> {
  const res = await fetch(rpcHttpUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBlockhashForAccounts',
      params: [writableAccounts],
    }),
  });
  const json = (await res.json()) as {
    result?: { blockhash?: string; lastValidBlockHeight?: number };
    error?: { message?: string };
  };
  if (!json.result?.blockhash || json.result.lastValidBlockHeight == null) {
    throw new Error(
      `getBlockhashForAccounts failed: ${json.error?.message ?? JSON.stringify(json)}`
    );
  }
  return {
    blockhash: json.result.blockhash as Blockhash,
    lastValidBlockHeight: BigInt(json.result.lastValidBlockHeight),
  };
}

async function resolveBlockhash(
  connection: Connection,
  instructions: Instruction[],
  rpcHttpUrl?: string
): Promise<BlockhashLifetime> {
  const httpUrl = rpcHttpUrl?.replace(/\/$/, '');
  if (httpUrl && (await isMagicBlockRouter(httpUrl))) {
    const writable = getWritableAccountsFromInstructions(instructions);
    return getBlockhashForAccounts(httpUrl, writable);
  }
  const { value } = await connection.rpc.getLatestBlockhash().send();
  return value;
}

/** HTTP polling fallback when WS signature subscriptions fail (common on TEE without ?token=). */
async function confirmViaHttpPolling(
  connection: Connection,
  signature: Signature,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }
    await new Promise(r => setTimeout(r, CONFIRM_POLL_MS));
  }
  throw new Error('Transaction confirmation timed out');
}

function isWebsocketConfirmationError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes('websocket') ||
    msg.includes('ws ') ||
    msg.includes('socket') ||
    msg.includes('subscription')
  );
}

export async function sendTransactionWithWallet({
  connection,
  feePayer,
  instructions,
  rpcHttpUrl,
}: {
  connection: Connection;
  feePayer: TransactionSigner;
  instructions: Instruction[];
  /** HTTP RPC URL for MagicBlock getBlockhashForAccounts (include ?token= for TEE). */
  rpcHttpUrl?: string;
}) {
  const latestBlockhash = await resolveBlockhash(connection, instructions, rpcHttpUrl);

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    msg => setTransactionMessageFeePayerSigner(feePayer, msg),
    msg => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    msg => appendTransactionMessageInstructions(instructions, msg)
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  const base64EncodedTransaction = getBase64EncodedWireTransaction(
    signedTransaction as Parameters<typeof getBase64EncodedWireTransaction>[0]
  );

  const signature = await connection.rpc
    .sendTransaction(base64EncodedTransaction, {
      encoding: 'base64',
      skipPreflight: true,
    })
    .send();

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), CONFIRM_TIMEOUT_MS);
  try {
    await connection.getRecentSignatureConfirmation({
      signature: signature as Signature,
      commitment: 'confirmed',
      abortSignal: abortController.signal,
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      throw new Error('Transaction confirmation timed out');
    }
    if (isWebsocketConfirmationError(err)) {
      await confirmViaHttpPolling(connection, signature as Signature, CONFIRM_TIMEOUT_MS);
      return;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
