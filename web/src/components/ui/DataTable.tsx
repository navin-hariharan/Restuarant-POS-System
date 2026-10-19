import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paginated } from '@/lib/api';
import { storage } from '@/lib/format';
import { Checkbox } from './Form';
import { useT } from '@/providers/AppProviders';
import { EmptyState, Pagination, useDebounced } from './Misc';
import { Skeleton } from './Spinner';

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell?: (row: T) => ReactNode;
  /** Column name sent to the API as sort[column]; omit to make it unsortable. */
  sortKey?: string;
  className?: string;
  headerClassName?: string;
};

export type SortState = { column: string; order: 'asc' | 'desc' };

/**
 * State + query for a server-paginated list endpoint
 * (`?search=&page=&perPage=&sort[column]=&sort[order]=&...filters`).
 */
export function useTableQuery<T>(
  url: string,
  opts: { filters?: Record<string, any>; defaultSort?: SortState; enabled?: boolean; perPageKey?: string } = {},
) {
  const perPageKey = opts.perPageKey ?? 'per_page';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPageState] = useState<number>(() => storage.get(perPageKey, 10));
  const [sort, setSort] = useState<SortState>(opts.defaultSort ?? { column: 'created_at', order: 'desc' });
  const debounced = useDebounced(search, 300);
  const params = { search: debounced || undefined, page, perPage, sort, ...(opts.filters ?? {}) };
  const query = useQuery({
    queryKey: [url, params],
    queryFn: async () => (await api.get<Paginated<T> | T[]>(url, { params })).data,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
  const data = query.data;
  // Some endpoints return a plain array and ignore `search`: filter those here.
  const items: T[] = Array.isArray(data)
    ? debounced
      ? data.filter((row) => JSON.stringify(row).toLowerCase().includes(debounced.toLowerCase()))
      : data
    : data?.items ?? [];
  const pagination = Array.isArray(data) ? null : data?.pagination ?? null;
  return {
    query,
    items,
    pagination,
    search,
    setSearch: (s: string) => {
      setSearch(s);
      setPage(1);
    },
    page,
    setPage,
    perPage,
    setPerPage: (n: number) => {
      storage.set(perPageKey, n);
      setPerPageState(n);
      setPage(1);
    },
    sort,
    setSort,
    params,
  };
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  rowKey,
  sort,
  onSort,
  selectable,
  selected,
  onSelectedChange,
  empty,
  onRowClick,
  footer,
  className,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  rowKey: (row: T) => string | number;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  selectable?: boolean;
  selected?: (string | number)[];
  onSelectedChange?: (ids: (string | number)[]) => void;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  const t = useT();
  const ids = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const sel = selected ?? [];
  const allSelected = ids.length > 0 && ids.every((id) => sel.includes(id));
  const someSelected = ids.some((id) => sel.includes(id));
  return (
    <div className={clsx('card overflow-hidden', className)}>
      <div className="relative overflow-x-auto">
        <table className={clsx('table-base', dense && '[&_td]:py-1.5')}>
          <thead className="bg-slate-50 dark:bg-slate-900/60">
            <tr>
              {selectable && (
                <th className="w-10">
                  <Checkbox
                    aria-label={t('Select all')}
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    onChange={(v) =>
                      onSelectedChange?.(v ? Array.from(new Set([...sel, ...ids])) : sel.filter((id) => !ids.includes(id)))
                    }
                  />
                </th>
              )}
              {columns.map((c) => {
                const active = sort && c.sortKey && sort.column === c.sortKey;
                return (
                  <th
                    key={c.key}
                    className={c.headerClassName}
                    aria-sort={active ? (sort!.order === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.sortKey && onSort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase hover:text-slate-800 dark:hover:text-slate-200"
                        onClick={() =>
                          onSort({ column: c.sortKey!, order: active && sort!.order === 'asc' ? 'desc' : 'asc' })
                        }
                      >
                        {c.header}
                        {active ? (
                          sort!.order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading && !rows.length
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {selectable && <td />}
                    {columns.map((c) => (
                      <td key={c.key}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const id = rowKey(row);
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={clsx(onRowClick && 'cursor-pointer', sel.includes(id) && 'bg-brand-50/60 dark:bg-brand-950/40')}
                    >
                      {selectable && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={t('Select row')}
                            checked={sel.includes(id)}
                            onChange={(v) => onSelectedChange?.(v ? [...sel, id] : sel.filter((x) => x !== id))}
                          />
                        </td>
                      )}
                      {columns.map((c) => (
                        <td key={c.key} className={c.className}>
                          {c.cell ? c.cell(row) : String((row as any)[c.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && !rows.length && (empty ?? <EmptyState />)}
      {footer}
    </div>
  );
}

/** Pagination footer wired to useTableQuery. */
export function TablePagination({ table }: { table: ReturnType<typeof useTableQuery<any>> }) {
  if (!table.pagination) return null;
  return (
    <div className="border-t border-slate-200 dark:border-slate-800">
      <Pagination
        page={table.pagination.currentPage}
        totalPages={table.pagination.totalPages}
        total={table.pagination.total}
        perPage={table.perPage}
        onPage={table.setPage}
        onPerPage={table.setPerPage}
      />
    </div>
  );
}
