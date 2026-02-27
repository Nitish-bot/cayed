import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { type Game } from '@client/cayed';
import { type MaybeAccount } from '@solana/kit';

import { ConnectionContext } from '@/context/connection-context';
import { fetchAllGameAccounts } from '@/services/fetch-accounts';

export function useGames() {
  const { connection } = useContext(ConnectionContext);
  const [games, setGames] = useState<MaybeAccount<Game>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const hasFetchedOnce = useRef(false);

  const fetchGames = useCallback(async () => {
    try {
      // Only show the loading spinner on the very first fetch.
      // Subsequent polls keep the stale list visible to avoid layout jitter.
      if (!hasFetchedOnce.current) setLoading(true);
      const decoded = await fetchAllGameAccounts(connectionRef.current);
      setGames(decoded);
      setError(null);
      hasFetchedOnce.current = true;
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
