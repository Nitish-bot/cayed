import { useNavigate } from 'react-router';

import { ConnectWalletMenu } from '@/components/connect-wallet-menu';

export function Nav() {
  const navigate = useNavigate();

  return (
    <nav className="border-arcade-border bg-arcade-bg/95 sticky top-0 z-40 border-b-2 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <button
          onClick={() => navigate('/')}
          className="text-arcade-cyan font-mono text-xl font-bold tracking-[0.3em] uppercase transition-all duration-100 hover:text-white"
          style={{
            textShadow: '0 0 10px rgb(0 255 204 / 0.4)',
          }}
        >
          CAYED
        </button>

        <ConnectWalletMenu />
      </div>
    </nav>
  );
}
