import { useNavigate } from 'react-router';

import { ConnectWalletMenu } from '@/components/connect-wallet-menu';

export function Nav() {
  const navigate = useNavigate();

  return (
    <nav className="border-arcade-border bg-arcade-bg sticky top-0 z-40 border-b-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <button
          onClick={() => navigate('/')}
          className="text-arcade-cyan font-pixel text-xs uppercase transition-none hover:text-white"
        >
          CAYED
        </button>

        <ConnectWalletMenu />
      </div>
    </nav>
  );
}
