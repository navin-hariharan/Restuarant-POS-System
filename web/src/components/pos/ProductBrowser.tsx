import clsx from 'clsx';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ImageOff, Layers, LayoutGrid, ScanBarcode } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import type { PosProduct } from '@/lib/cart';
import { EmptyState, fallbackTo, SearchInput, Skeleton, useDebounced } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import { useCategories } from './queries';

export type ProductBrowserHandle = { focusSearch: () => void };

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** Find a product or variant whose SKU/UPC equals the scanned code. */
export function findByCode(items: PosProduct[], code: string): PosProduct | null {
  const c = norm(code);
  if (!c) return null;
  for (const p of items) {
    if (!p.has_variants && (norm(p.sku) === c || norm(p.upc) === c)) return p;
    for (const v of p.variants ?? []) if (norm(v.sku) === c || norm(v.upc) === c) return v;
    if (norm(p.sku) === c || norm(p.upc) === c) return p;
  }
  return null;
}

type Props = {
  cols: number;
  perPage: number;
  onPick: (p: PosProduct) => void;
  /** Add directly (used for scanned codes that resolve to a variant). */
  onAdd: (p: PosProduct) => void;
};

export const ProductBrowser = forwardRef<ProductBrowserHandle, Props>(function ProductBrowser({ cols, perPage, onPick, onAdd }, ref) {
  const t = useT();
  const { money } = useConfig();
  const [category, setCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim(), 300);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focusSearch: () => inputRef.current?.focus() }), []);

  const categories = useCategories();
  const params = { page, perPage, search: debounced || undefined, category: category ?? undefined };
  const products = useQuery({
    queryKey: ['pos', 'products', params],
    queryFn: async () => (await api.get<Paginated<PosProduct>>('pos/products', { params })).data,
    placeholderData: keepPreviousData,
  });

  useEffect(() => setPage(1), [debounced, category, perPage]);

  const items = products.data?.items ?? [];
  const totalPages = products.data?.pagination?.totalPages ?? 1;

  // If the current page is past the end (e.g. per page changed), jump back like the old UI did.
  useEffect(() => {
    if (products.data && page > Math.max(1, totalPages)) setPage(Math.max(1, totalPages));
  }, [products.data, page, totalPages]);

  const handleEnter = async (value: string) => {
    const code = value.trim();
    if (!code) return;
    let hit = findByCode(items, code);
    if (!hit) {
      try {
        const r = await api.get<Paginated<PosProduct>>('pos/products', { params: { search: code, perPage: 50, page: 1 } });
        hit = findByCode(r.data.items ?? [], code);
      } catch {
        return;
      }
    }
    if (hit) {
      if (hit.food_item_id) onAdd(hit);
      else onPick(hit);
      setSearch('');
    } else {
      toast.warning(t('No product found with this code'));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Category rail */}
      <nav
        aria-label={t('Categories')}
        className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900 lg:w-32 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-b-0 lg:border-e"
      >
        <CategoryButton active={category === null} onClick={() => setCategory(null)} label={t('All')} icon={<LayoutGrid className="h-5 w-5" />} />
        {categories.isLoading &&
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-24 shrink-0 lg:w-full" />)}
        {(categories.data ?? []).map((c) => (
          <CategoryButton
            key={c.id}
            active={category === c.id}
            onClick={() => setCategory(category === c.id ? null : c.id)}
            label={c.name}
            image={c.image}
          />
        ))}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 p-3">
          <SearchInput
            inputRef={inputRef}
            value={search}
            onChange={setSearch}
            onEnter={handleEnter}
            className="flex-1 [&_input]:h-11 [&_input]:text-base"
            placeholder={t('Search by name, SKU or scan barcode')}
          />
          <ScanBarcode className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" aria-hidden="true" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {products.isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-44" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState title={t('No products found')} />
          ) : (
            <div
              className={clsx(
                'grid grid-cols-2 gap-3 sm:grid-cols-3',
                cols ? 'lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]' : 'sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]',
                products.isFetching && 'opacity-70 transition-opacity',
              )}
              style={{ '--cols': cols } as CSSProperties}
            >
              {items.map((p) => (
                <ProductCard key={p.uuid} product={p} money={money} onClick={() => onPick(p)} variantsLabel={t('Variants')} />
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
            <button className="btn-secondary h-11 w-11 p-0!" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t('Previous')}>
              <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
            </button>
            <span className="min-w-20 text-center text-sm tabular-nums text-slate-600 dark:text-slate-300">
              {page} / {totalPages}
            </span>
            <button className="btn-secondary h-11 w-11 p-0!" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label={t('Next')}>
              <ChevronRight className="h-5 w-5 rtl:rotate-180" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
});

function CategoryButton({ active, onClick, label, image, icon }: { active: boolean; onClick: () => void; label: string; image?: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'flex min-h-14 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center text-xs font-medium transition lg:w-full',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950 dark:text-brand-300'
          : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      {image ? <img src={image} alt="" className="h-7 w-7 rounded-md object-cover" loading="lazy" onError={fallbackTo('category')} /> : icon}
      <span className="line-clamp-2 w-full wrap-break-word">{label}</span>
    </button>
  );
}

function ProductCard({ product: p, onClick, money, variantsLabel }: { product: PosProduct; onClick: () => void; money: (v: unknown) => string; variantsLabel: string }) {
  const hasVariants = !!p.has_variants && (p.variants?.length ?? 0) > 0;
  const prices = hasVariants ? (p.variants ?? []).map((v) => Number(v.price)) : [];
  const from = prices.length ? Math.min(...prices) : Number(p.price);
  const outOfStock = Number(p.in_stock ?? 1) <= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-start shadow-xs transition hover:border-brand-400 hover:shadow-md active:scale-[0.98] dark:border-slate-800 dark:bg-slate-900',
        outOfStock && 'opacity-50',
      )}
    >
      <div className="relative aspect-4/3 w-full bg-slate-100 dark:bg-slate-800">
        {p.image ? (
          <img src={p.image} alt="" loading="lazy" className="h-full w-full object-cover" onError={fallbackTo('product')} />
        ) : (
          <ImageOff className="absolute inset-0 m-auto h-6 w-6 text-slate-300" />
        )}
        {hasVariants && (
          <span className="absolute inset-e-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-slate-900/75 px-2 py-0.5 text-[11px] font-medium text-white">
            <Layers className="h-3 w-3" />
            {p.variants!.length} {variantsLabel}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{p.name}</span>
        <span className="mt-auto text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-300">
          {hasVariants && prices.length > 1 ? '≥ ' : ''}
          {money(from)}
        </span>
      </div>
    </button>
  );
}
