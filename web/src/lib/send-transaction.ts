import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';

import type { Connection } from 'solana-kite';

/**
 * Build, sign, encode, and send a transaction via the given RPC connection.
 *
 * This replaces `connection.sendTransactionFromInstructionsWithWalletApp`
 * which has a bug in solana-kite where the signed transaction bytes are
 * passed directly to `rpc.sendTransaction` instead of being base64-encoded,
 * causing "invalid type: map, expected a string" errors with @solana/kit v6.
 */
export async function sendTransactionWithWallet({
  connection,
  feePayer,
  instructions,
}: {
  connection: Connection;
  feePayer: TransactionSigner;
  instructions: Instruction[];
}) {
  const { value: latestBlockhash } = await connection.rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    msg => setTransactionMessageFeePayerSigner(feePayer, msg),
    msg => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    msg => appendTransactionMessageInstructions(instructions, msg),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  const base64EncodedTransaction = getBase64EncodedWireTransaction(
    signedTransaction as Parameters<typeof getBase64EncodedWireTransaction>[0],
  );

  await connection.rpc
    .sendTransaction(base64EncodedTransaction, {
      encoding: 'base64',
      skipPreflight: true,
    })
    .send();
}
