import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { address } from '@solana/kit';

import { ChainContext } from '@/context/chain-context';
import {
  GameService,
  DEFAULT_GAME_SERVICE_CONFIG,
  type GameServiceConfig,
} from '@/services/game-service';

// ─── Context ─────────────────────────────────────────────────────────

const GameServiceContext = createContext<GameService | null>(null);

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Access the singleton `GameService` from anywhere inside the provider tree.
 * Throws if used outside `<GameServiceProvider>`.
 */
export function useGameService(): GameService {
  const ctx = useContext(GameServiceContext);
  if (!ctx) {
    throw new Error('useGameService must be used within a <GameServiceProvider>');
  }
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────

export interface GameServiceProviderProps {
  children: ReactNode;
  /** Override the default ER / devnet URLs. */
  config?: Partial<GameServiceConfig>;
}

/**
 * Creates a single `GameService` instance scoped to the current chain config
 * and makes it available via `useGameService()`.
 */
export function GameServiceProvider({ children, config }: GameServiceProviderProps) {
  const { solanaRpcUrl, solanaRpcSubscriptionsUrl } = useContext(ChainContext);

  const service = useMemo(() => {
    const erValidatorEnv = import.meta.env.VITE_ER_VALIDATOR;

    return new GameService({
      devnetUrl: config?.devnetUrl ?? solanaRpcUrl,
      devnetWsUrl: config?.devnetWsUrl ?? solanaRpcSubscriptionsUrl,
      ephemeralUrl: config?.ephemeralUrl ?? DEFAULT_GAME_SERVICE_CONFIG.ephemeralUrl,
      ephemeralWsUrl:
        config?.ephemeralWsUrl ?? DEFAULT_GAME_SERVICE_CONFIG.ephemeralWsUrl,
      erValidator:
        config?.erValidator ??
        (erValidatorEnv
          ? address(erValidatorEnv)
          : DEFAULT_GAME_SERVICE_CONFIG.erValidator),
    });
  }, [solanaRpcUrl, solanaRpcSubscriptionsUrl, config]);

  return (
    <GameServiceContext.Provider value={service}>{children}</GameServiceContext.Provider>
  );
}
