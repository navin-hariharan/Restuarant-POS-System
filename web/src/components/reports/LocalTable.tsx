import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DataTable, Pagination, SearchInput, type Column, type SortState } from '@/components/ui';
import { useT } from '@/providers/AppProviders';

export type LocalColumn<T> = Column<T> & {
  /** Value used for client-side sorting; enables sorting on the column. */
  sortValue?: (row: T) => string | number | null | undefined;
};

/**
 * DataTable over an in-memory array (report endpoints return full lists):
 * client-side search, sort and paging.
 */
export function LocalTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  searchText,
  searchPlaceholder,
  initialSort,
  pageSize = 25,
  footer,
  toolbar,
  empty,
  onRowClick,
  printAll,
}: {
  rows: T[];
  columns: LocalColumn<T>[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  /** Text to match the search box against; omit to hide search. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  initialSort?: SortState;
  pageSize?: number;
  footer?: ReactNode;
  toolbar?: ReactNode;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Render every row (no paging), e.g. while printing. */
  printAll?: boolean;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | undefined>(initialSort);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(pageSize);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
    const col = sort && columns.find((c) => (c.sortKey ?? c.key) === sort.column && c.sortValue);
    if (sort && col?.sortValue) {
      const dir = sort.order === 'asc' ? 1 : -1;
      const get = col.sortValue;
      out = [...out].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
      });
    }
    return out;
  }, [rows, search, sort, columns, searchText]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);
  const visible = printAll ? filtered : filtered.slice((page - 1) * perPage, page * perPage);

  const cols: Column<T>[] = columns.map((c) => (c.sortValue ? { ...c, sortKey: c.sortKey ?? c.key } : { ...c, sortKey: undefined }));

  return (
    <div>
      {(searchText || toolbar) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 no-print">
          {searchText && (
            <SearchInput
              className="w-full sm:max-w-xs"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={searchPlaceholder ?? t('Search')}
            />
          )}
          {toolbar}
        </div>
      )}
      <DataTable
        columns={cols}
        rows={visible}
        rowKey={rowKey}
        loading={loading}
        sort={sort}
        onSort={setSort}
        empty={empty}
        onRowClick={onRowClick}
        footer={
          <>
            {footer}
            {!printAll && filtered.length > perPage && (
              <div className="border-t border-slate-200 no-print dark:border-slate-800">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={filtered.length}
                  perPage={perPage}
                  onPage={setPage}
                  onPerPage={(n) => {
                    setPerPage(n);
                    setPage(1);
                  }}
                />
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
