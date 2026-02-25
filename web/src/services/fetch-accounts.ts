import {
  CAYED_PROGRAM_ADDRESS,
  Game,
  GAME_DISCRIMINATOR,
  getGameDecoder,
} from '@client/cayed';
import { fetchEncodedAccount } from '@solana/accounts';
import {
  Address,
  decodeAccount,
  getBase58Decoder,
  MaybeAccount,
  parseBase64RpcAccount,
} from '@solana/kit';
import { Connection } from 'solana-kite';

/**
 * Fetch all Game program accounts, decoding each individually and skipping any
 * that fail (e.g. MagicBlock delegation buffers that share the program owner
 * but have a different layout, or accounts currently delegated to the ER).
 */
export async function fetchAllGameAccounts(
  connection: Connection
): Promise<MaybeAccount<Game>[]> {
  const rawBytes = await getRawBytes(connection);

  const gameDecoder = getGameDecoder();
  const results: MaybeAccount<Game>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of rawBytes as any as Array<{ pubkey: any; account: any }>) {
    try {
      const encoded = parseBase64RpcAccount(item.pubkey, item.account);
      const decoded = decodeAccount(
        { ...encoded, data: Uint8Array.from(encoded.data) },
        gameDecoder
      );
      results.push({ ...decoded, exists: true });
    } catch {
      // skip undecipherable accounts
    }
  }
  return results;
}

/**
 * Fetch a single Game account by address. Returns `{ exists: false }` if the
 * account is missing or cannot be decoded (e.g. currently delegated to the ER).
 */
export async function fetchGameAccount(
  connection: Connection,
  address: Address
): Promise<MaybeAccount<Game>> {
  try {
    const gameDecoder = getGameDecoder();

    const encoded = await fetchEncodedAccount(connection.rpc, address);
    if (!encoded.exists) {
      return { exists: false, address } as MaybeAccount<Game>;
    }
    const decoded = decodeAccount(
      { ...encoded, data: Uint8Array.from(encoded.data) },
      gameDecoder
    );

    return { ...decoded, exists: true };
  } catch {
    console.log(`account exists but can't be decoded`);
    return { exists: false, address } as MaybeAccount<Game>;
  }
}

async function getRawBytes(connection: Connection) {
  const bs58 = getBase58Decoder();
  const GAME_DISCRIMINATOR_BYTES = bs58.decode(GAME_DISCRIMINATOR);

  return await connection.rpc
    .getProgramAccounts(CAYED_PROGRAM_ADDRESS, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: 0n,
            // @ts-expect-error bytes as Uint8Array works at runtime
            bytes: GAME_DISCRIMINATOR_BYTES,
            encoding: 'base58',
          },
        },
      ],
    })
    .send();
}
