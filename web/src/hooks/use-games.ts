import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { GAME_DISCRIMINATOR, getGameDecoder, type Game } from '@client/cayed';
import { type MaybeAccount } from '@solana/kit';

import { ConnectionContext } from '@/context/connection-context';
import { CAYED_PROGRAM_ADDRESS } from '@/lib/constants';

/**
 * Resilient version of solana-kite's getAccountsFactory that skips
 * accounts whose data can't be decoded (e.g. MagicBlock delegation
 * buffers that share the program owner but have a different layout).
 */
async function fetchGameAccountsSafe(
  connection: ReturnType<typeof import('solana-kite').connect>
): Promise<MaybeAccount<Game>[]> {
  const getGames = connection.getAccountsFactory(
    CAYED_PROGRAM_ADDRESS,
    GAME_DISCRIMINATOR,
    getGameDecoder()
  );

  // getAccountsFactory blows up if *any* account fails to decode.
  // We catch that and fall back to a per-account approach.
  try {
    return await getGames();
  } catch {
    // Fall through to manual per-account fetch
  }

  // Manual fallback: fetch raw, decode individually, skip failures
  const { getBase58Decoder, parseBase64RpcAccount, decodeAccount } =
    await import('@solana/kit');
  const base58 = getBase58Decoder();
  const decoder = getGameDecoder();

  const raw = await connection.rpc
    .getProgramAccounts(CAYED_PROGRAM_ADDRESS, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      encoding: 'jsonParsed' as any,
      filters: [
        {
          memcmp: {
            offset: 0n,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            bytes: base58.decode(GAME_DISCRIMINATOR) as any,
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
        decoder
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results.push({ ...decoded, exists: true } as any);
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
