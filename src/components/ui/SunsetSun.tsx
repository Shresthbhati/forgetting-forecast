import { cn } from '@/lib/utils';

/** The striped sunset sun (decorative). Used on the landing hero, auth pages and big empty states. */
export function SunsetSun({ size = 96, className }: { size?: number; className?: string }) {
  return <div aria-hidden="true" className={cn('sunset-sun shrink-0', className)} style={{ width: size, height: size }} />;
}

export default SunsetSun;
