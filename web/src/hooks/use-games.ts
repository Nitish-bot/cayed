import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { GAME_DISCRIMINATOR, getGameDecoder, type Game } from '@client/cayed';

import { ConnectionContext } from '@/context/connection-context';
import { CAYED_PROGRAM_ADDRESS } from '@/lib/constants';

import type { MaybeAccount } from '@solana/kit';

export function useGames() {
  const { connection } = useContext(ConnectionContext);
  const [games, setGames] = useState<MaybeAccount<Game>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Memoize so a new function ref isn't created every render
  const getGames = useMemo(
    () =>
      connection.getAccountsFactory(
        CAYED_PROGRAM_ADDRESS,
        GAME_DISCRIMINATOR,
        getGameDecoder()
      ),
    [connection]
  );

  // Stable ref so the useEffect doesn't re-fire on every render
  const getGamesRef = useRef(getGames);
  getGamesRef.current = getGames;

  const fetchGames = useCallback(async () => {
    try {
      setLoading(true);
      const results = await getGamesRef.current();
      setGames(results);
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
