import { useState } from 'react';

export const DEFAULT_ICON = '/images/default/icon.png';

/** The configured app icon, falling back to the bundled one when it cannot be loaded. */
export function BrandIcon({ src, className }: { src?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <img src={!src || failed ? DEFAULT_ICON : src} alt="" className={className} onError={() => setFailed(true)} />;
}

/** onError handler that swaps a missing picture for one of the bundled placeholders. */
export function fallbackTo(kind: 'product' | 'category') {
  const url = `/images/default/${kind}.png`;
  return (e: { currentTarget: HTMLImageElement }) => {
    const img = e.currentTarget;
    if (!img.src.endsWith(url)) img.src = url;
  };
}
