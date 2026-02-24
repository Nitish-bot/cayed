import { BrowserRouter, Route, Routes } from 'react-router';

import { Nav } from '@/components/nav';
import { BattleshipGame } from '@/pages/battleship/game';
import { BattleshipLobby } from '@/pages/battleship/lobby';
import { Index } from '@/pages/home-screen';
import { NotFound } from '@/pages/not-found';
import { RouteProvider } from '@/providers/router-provider';

export function App() {
  return (
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
  );
}
