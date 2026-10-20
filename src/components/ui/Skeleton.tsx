import { cn } from '@/lib/utils';

/** Loading placeholder with a shimmer (static under prefers-reduced-motion). Give it a size via className. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-md bg-panel-hi',
        'bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.07),transparent)] bg-[length:200%_100%]',
        'animate-[shimmer_1.4s_linear_infinite] motion-reduce:animate-none',
        className
      )}
    />
  );
}

export default Skeleton;
