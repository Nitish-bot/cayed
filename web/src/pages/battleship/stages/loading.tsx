import { useNavigate } from 'react-router';

export function LoadingStage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-arcade-cyan font-pixel animate-pixel-blink text-[10px] tracking-widest uppercase">
        LOADING GAME...
      </p>
    </div>
  );
}

export function ErrorStage({ error }: { error: string }) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <p className="text-arcade-red font-pixel text-[10px]">{error}</p>
        <button
          onClick={() => navigate('/battleship')}
          className="text-arcade-cyan font-pixel mt-6 text-[8px] uppercase hover:underline"
        >
          &lt; BACK TO LOBBY
        </button>
      </div>
    </div>
  );
}
