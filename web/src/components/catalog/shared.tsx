import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { api, listItems } from '@/lib/api';

/**
 * Fetch a whole list (paginated or plain array) for selects/filters; cached for a minute.
 * Silent: some option endpoints are gated by another resource's permission, and a missing
 * option list should not toast an error over the page.
 */
export function useList<T = any>(url: string, opts: { enabled?: boolean; params?: Record<string, any> } = {}) {
  const q = useQuery({
    queryKey: [url, 'all', opts.params ?? null],
    queryFn: async () => listItems<T>((await api.get(url, { params: { perPage: 1000, ...(opts.params ?? {}) }, silent: true })).data),
    enabled: opts.enabled ?? true,
  });
  return { ...q, items: q.data ?? [] };
}

/** Small square thumbnail with graceful fallback. */
export function Thumb({ src, alt = '', size = 'h-9 w-9', rounded = 'rounded-md' }: { src?: string | null; alt?: string; size?: string; rounded?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`inline-flex ${size} shrink-0 items-center justify-center overflow-hidden ${rounded} bg-slate-100 text-slate-400 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700`}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <ImageOff className="h-4 w-4" aria-hidden="true" />
      )}
    </span>
  );
}

/** Coerce a form value to a number for comparisons (empty -> NaN). */
export const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));

/** API booleans may arrive as 1/0/"1"/"true". */
export const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
