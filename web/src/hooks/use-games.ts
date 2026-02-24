import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { GAME_DISCRIMINATOR, getGameDecoder, type Game } from '@client/cayed';
import {
  parseBase64RpcAccount,
  decodeAccount,
  type MaybeAccount,
  getBase58Decoder,
} from '@solana/kit';
import { type Connection } from 'solana-kite';

import { ConnectionContext } from '@/context/connection-context';
import { CAYED_PROGRAM_ADDRESS } from '@/lib/constants';

/**
 * Resilient version of solana-kite's getAccountsFactory that skips
 * accounts whose data can't be decoded (e.g. MagicBlock delegation
 * buffers that share the program owner but have a different layout).
 */
async function fetchGameAccountsSafe(
  connection: Connection
): Promise<MaybeAccount<Game>[]> {
  const bs58 = getBase58Decoder();
  const gameDecoder = getGameDecoder();

  const GAME_DISCRIMINATOR_BYTES = bs58.decode(GAME_DISCRIMINATOR);
  const raw = await connection.rpc
    .getProgramAccounts(CAYED_PROGRAM_ADDRESS, {
      encoding: 'jsonParsed',
      filters: [
        {
          memcmp: {
            offset: 0n,
            // @ts-expect-error I have no idea how providing a string works here
            bytes: GAME_DISCRIMINATOR_BYTES,
            encoding: 'base58',
          },
        },
      ],
    })
    .send();

  const results: MaybeAccount<Game>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of raw as any as Array<{ pubkey: any; account: any }>) {
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

export function useGames() {
  const { connection } = useContext(ConnectionContext);
  const [games, setGames] = useState<MaybeAccount<Game>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  const fetchGames = useCallback(async () => {
    try {
      setLoading(true);
      const decoded = await fetchGameAccountsSafe(connectionRef.current);
      setGames(decoded);
      setError(null);
    } catch (err) {
      setError(err as Error);
      console.error('Error fetching games:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGames();
  }, [fetchGames]);

  return { games, loading, error, refetch: fetchGames };
}
