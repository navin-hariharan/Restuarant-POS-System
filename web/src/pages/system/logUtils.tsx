import { Laptop, Monitor, Smartphone, Tablet } from 'lucide-react';

/** App\Http\Resources\ActivityLogResource */
export type ActivityLog = {
  id: number;
  user: string;
  ip: string | null;
  activity: string;
  device: string | null;
  link: string | null;
  created_at: string;
  updated_at: string;
};

/** Short "Browser · OS" summary of a user-agent string. */
export function describeDevice(ua: string | null | undefined): { label: string; kind: 'mobile' | 'tablet' | 'desktop' | 'unknown' } {
  if (!ua) return { label: '—', kind: 'unknown' };
  if (!/mozilla|opera|curl|okhttp|dart|postman/i.test(ua)) return { label: ua, kind: 'unknown' };
  const browser =
    /edg\//i.test(ua) ? 'Edge'
    : /opr\/|opera/i.test(ua) ? 'Opera'
    : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /chrome|crios/i.test(ua) ? 'Chrome'
    : /safari/i.test(ua) ? 'Safari'
    : /curl/i.test(ua) ? 'curl'
    : /postman/i.test(ua) ? 'Postman'
    : 'Browser';
  const os =
    /windows/i.test(ua) ? 'Windows'
    : /android/i.test(ua) ? 'Android'
    : /iphone|ipad|ipod/i.test(ua) ? 'iOS'
    : /mac os/i.test(ua) ? 'macOS'
    : /cros/i.test(ua) ? 'ChromeOS'
    : /linux/i.test(ua) ? 'Linux'
    : '';
  const kind = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|iphone|android/i.test(ua) ? 'mobile' : 'desktop';
  return { label: os ? `${browser} · ${os}` : browser, kind };
}

export function DeviceCell({ ua }: { ua: string | null }) {
  const d = describeDevice(ua);
  const Icon = d.kind === 'mobile' ? Smartphone : d.kind === 'tablet' ? Tablet : d.kind === 'desktop' ? Laptop : Monitor;
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1.5 text-slate-600 dark:text-slate-300" title={ua ?? undefined}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      <span className="truncate">{d.label}</span>
    </span>
  );
}

/** Only show the path of logged URLs. */
export function shortLink(link: string | null): string {
  if (!link) return '';
  try {
    const u = new URL(link);
    return u.pathname + u.search;
  } catch {
    return link;
  }
}
