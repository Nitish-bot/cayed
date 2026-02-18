import { ArrowLeft } from '@untitledui/icons';
import { useNavigate } from 'react-router';

import { Button } from '@/components/base/buttons/button';

export function NotFound() {
  const router = useNavigate();

  return (
    <section className="bg-primary flex min-h-screen items-start py-16 md:items-center md:py-24">
      <div className="max-w-container mx-auto grow px-4 md:px-8">
        <div className="flex w-full max-w-3xl flex-col gap-8 md:gap-12">
          <div className="flex flex-col gap-4 md:gap-6">
            <div className="flex flex-col gap-3">
              <span className="text-md text-brand-secondary font-semibold">
                404 error
              </span>
              <h1 className="text-display-md text-primary md:text-display-lg lg:text-display-xl font-semibold">
                We can’t find that page
              </h1>
            </div>
            <p className="text-tertiary text-lg md:text-xl">
              Sorry, the page you are looking for doesn't exist or has been moved.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button
              color="secondary"
              size="xl"
              iconLeading={ArrowLeft}
              onClick={() => router(-1)}
            >
              Go back
            </Button>
            <Button size="xl" onClick={() => router(-1)}>
              Take me home
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
