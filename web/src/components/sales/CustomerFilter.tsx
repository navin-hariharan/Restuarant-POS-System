import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { User, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useDebounced } from '@/components/ui';
import { useT } from '@/providers/AppProviders';

type Customer = { id: number; name: string; phone?: string | null; email?: string | null };

/** Small async combobox for filtering by customer (GET pos/customers?search=). */
export function CustomerFilter({
  value,
  valueLabel,
  label,
  onChange,
  className,
}: {
  value: string;
  valueLabel?: string;
  label?: string;
  onChange: (id: string, name: string) => void;
  className?: string;
}) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(text, 300);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['pos/customers', debounced],
    queryFn: async () => (await api.get<Customer[]>('pos/customers', { params: { search: debounced }, silent: true })).data,
    enabled: open && debounced.length > 0,
  });
  const results = q.data ?? [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (c: Customer) => {
    onChange(String(c.id), c.name);
    setText('');
    setOpen(false);
  };

  return (
    <div className={clsx('relative', className)} ref={ref}>
      <label className="label" htmlFor={id}>
        {label ?? t('Customer')}
      </label>
      {value ? (
        <div className="input flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 truncate">
            <User className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{valueLabel || `#${value}`}</span>
          </span>
          <button type="button" className="rounded-sm p-0.5 text-slate-400 hover:text-slate-700" onClick={() => onChange('', '')} aria-label={t('Clear')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <input
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          placeholder={t('Search name, phone or email')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && results[active]) {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
      )}
      {open && !value && text && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {q.isFetching && !results.length && <li className="px-3 py-2 text-sm text-slate-500">{t('Loading...')}</li>}
          {!q.isFetching && !results.length && <li className="px-3 py-2 text-sm text-slate-500">{t('No data found')}</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={clsx('cursor-pointer px-3 py-2 text-sm', i === active ? 'bg-slate-100 dark:bg-slate-800' : '')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <p className="font-medium">{c.name}</p>
              {(c.phone || c.email) && <p className="text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
