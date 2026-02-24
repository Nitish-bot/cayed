import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { ChainContextProvider } from '@/context/chain-context-provider';
import { ConnectionContextProvider } from '@/context/connection-context-provider';
import { GameServiceProvider } from '@/context/game-service-provider';
import { SelectedWalletAccountContextProvider } from '@/context/selected-wallet-account-context-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import '@/styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <ChainContextProvider>
        <SelectedWalletAccountContextProvider>
          <ConnectionContextProvider>
            <GameServiceProvider>
              <App />
            </GameServiceProvider>
          </ConnectionContextProvider>
        </SelectedWalletAccountContextProvider>
      </ChainContextProvider>
    </ThemeProvider>
  </StrictMode>
);
