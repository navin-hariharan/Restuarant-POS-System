import { useMemo } from 'react';
import { encodeQr, type QrEcc } from './qrcode';

/** Crisp, printable SVG QR code (rendered locally, no network). */
export function QrCode({
  value,
  size = 192,
  ecc = 'M',
  title,
  className,
}: {
  value: string;
  size?: number;
  ecc?: QrEcc;
  title?: string;
  className?: string;
}) {
  const { path, dim } = useMemo(() => {
    const m = encodeQr(value, ecc);
    const quiet = 4;
    let d = '';
    m.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + quiet},${y + quiet}h1v1h-1z`;
      }),
    );
    return { path: d, dim: m.length + quiet * 2 };
  }, [value, ecc]);
  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      role="img"
      aria-label={title ?? value}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={dim} height={dim} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
