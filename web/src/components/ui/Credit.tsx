import clsx from 'clsx';
import { useT } from '@/providers/AppProviders';

export const DEVELOPER = 'Navin Hariharan';

/** Small "Developed by" line shown in the sidebar and on the sign-in pages. */
export function Credit({ className }: { className?: string }) {
  const t = useT();
  return (
    <p className={clsx('text-[11px] leading-tight', className)}>
      {t('Developed by')} <span className="font-medium">{DEVELOPER}</span>
    </p>
  );
}
