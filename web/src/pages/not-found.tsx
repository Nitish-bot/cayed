import { useNavigate } from 'react-router';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <section className="bg-arcade-bg flex min-h-screen flex-col items-center justify-center px-4">
      <p className="text-arcade-red font-pixel mb-4 text-[8px] uppercase">ERROR 404</p>
      <h1 className="text-arcade-cyan font-pixel mb-6 text-xl uppercase">
        GAME NOT FOUND
      </h1>
      <p className="text-arcade-muted font-pixel mb-10 text-[7px]">
        THIS SECTOR IS EMPTY, CAPTAIN
      </p>

      <div className="flex gap-4">
        <button
          onClick={() => navigate(-1)}
          className="border-arcade-border text-arcade-muted hover:border-arcade-cyan hover:text-arcade-cyan font-pixel border-4 px-5 py-2 text-[7px] uppercase transition-none"
        >
          &lt; GO BACK
        </button>
        <button
          onClick={() => navigate('/')}
          className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg font-pixel border-4 px-5 py-2 text-[7px] uppercase transition-none"
        >
          HOME
        </button>
      </div>
    </section>
  );
}
