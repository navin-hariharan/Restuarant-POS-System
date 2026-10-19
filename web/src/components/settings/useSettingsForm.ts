import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, fieldErrors } from '@/lib/api';
import { useConfig, useT } from '@/providers/AppProviders';

/** Settings come back as 1/0/"1"/"true"/true; normalise to a real boolean. */
export const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof File || b instanceof File) return a === b;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type SettingsForm<T extends Record<string, any>> = {
  values: T;
  initial: T | null;
  raw: any;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  setMany: (patch: Partial<T>) => void;
  errors: Record<string, string>;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  save: () => void;
  reset: () => void;
};

/**
 * Load one settings endpoint (GET), keep an editable copy, track dirty state
 * and save back with POST. After saving the public app config is refreshed so
 * mode flags / branding update live.
 */
export function useSettingsForm<T extends Record<string, any>>(opts: {
  endpoint: string;
  /** Map the GET response into form values. */
  select: (data: any) => T;
  /** Build the POST body (object or FormData). Defaults to the values. */
  toPayload?: (values: T) => any;
  /** Called after a successful save (after config refresh). */
  onSaved?: (values: T) => void;
  /** Endpoint used for saving when different from the GET endpoint. */
  saveEndpoint?: string;
}): SettingsForm<T> {
  const t = useT();
  const qc = useQueryClient();
  const { refresh } = useConfig();
  const q = useQuery({
    queryKey: ['settings', opts.endpoint],
    queryFn: async () => (await api.get(opts.endpoint)).data,
    staleTime: 0,
    gcTime: 0,
  });
  const [values, setValues] = useState<T>({} as T);
  const [initial, setInitial] = useState<T | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Background refreshes must not wipe edits that are not saved yet.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (q.data === undefined || dirtyRef.current) return;
    const v = opts.select(q.data);
    setValues(v);
    setInitial(v);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((s) => ({ ...s, [key]: value }));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const { [key as string]: _drop, ...rest } = e;
      return rest;
    });
  }, []);
  const setMany = useCallback((patch: Partial<T>) => setValues((s) => ({ ...s, ...patch })), []);

  const dirty = useMemo(() => {
    if (!initial) return false;
    const keys = new Set([...Object.keys(initial), ...Object.keys(values)]);
    for (const k of keys) if (!sameValue(values[k], initial[k])) return true;
    return false;
  }, [values, initial]);
  dirtyRef.current = dirty;

  const mutation = useMutation({
    mutationFn: async () => {
      const body = opts.toPayload ? opts.toPayload(values) : values;
      return api.post(opts.saveEndpoint ?? opts.endpoint, body);
    },
    onSuccess: async (res) => {
      toast.success(res.data?.message ?? t('Settings updated successfully'));
      setErrors({});
      const saved = values;
      setInitial(saved);
      await Promise.allSettled([refresh(), qc.invalidateQueries({ queryKey: ['settings', opts.endpoint] })]);
      opts.onSaved?.(saved);
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  return {
    values,
    initial,
    raw: q.data,
    set,
    setMany,
    errors,
    loading: q.isLoading || initial === null,
    saving: mutation.isPending,
    dirty,
    save: () => mutation.mutate(),
    reset: () => {
      if (initial) setValues(initial);
      setErrors({});
    },
  };
}
