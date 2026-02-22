import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';

import { Nav } from '@/components/nav';
import { ChainContextProvider } from '@/context/chain-context-provider';
import { ConnectionContextProvider } from '@/context/connection-context-provider';
import { SelectedWalletAccountContextProvider } from '@/context/selected-wallet-account-context-provider';
import { BattleshipGame } from '@/pages/battleship/game';
import { BattleshipLobby } from '@/pages/battleship/lobby';
import { Index } from '@/pages/home-screen';
import { NotFound } from '@/pages/not-found';
import { RouteProvider } from '@/providers/router-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import '@/styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <ChainContextProvider>
        <SelectedWalletAccountContextProvider>
          <ConnectionContextProvider>
            <BrowserRouter basename="/cayed">
              <RouteProvider>
                <div className="bg-arcade-bg text-arcade-text flex min-h-screen flex-col">
                  <Nav />
                  <main className="flex-1">
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/battleship" element={<BattleshipLobby />} />
                      <Route path="/battleship/:gameId" element={<BattleshipGame />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </main>
                </div>
              </RouteProvider>
            </BrowserRouter>
          </ConnectionContextProvider>
        </SelectedWalletAccountContextProvider>
      </ChainContextProvider>
    </ThemeProvider>
  </StrictMode>
);
