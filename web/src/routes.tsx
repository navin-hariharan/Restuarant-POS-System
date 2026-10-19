import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { AppShell } from '@/layout/AppShell';
import { FullScreenLoader, Spinner } from '@/components/ui';
import { homePath, navGroups } from '@/nav';
import type { Modes } from '@/lib/types';

const page = (loader: () => Promise<{ default: ComponentType<any> }>) => {
  const C = lazy(loader);
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <C />
    </Suspense>
  );
};

export function Forbidden() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <ShieldAlert className="h-10 w-10 text-amber-500" />
      <h1 className="text-lg font-semibold">{t('Access denied')}</h1>
      <p className="max-w-sm text-sm text-slate-500">{t('You have not permit to perform this request')}</p>
    </div>
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <p className="text-sm text-slate-500">{t('Page not found')}</p>
    </div>
  );
}

function RouteError() {
  const err = useRouteError() as any;
  return (
    <div className="p-8 text-center">
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1 text-sm text-slate-500">{String(err?.message ?? err ?? '')}</p>
      <button className="btn-primary mt-4" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}

function RequireAuth() {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={`/auth/login?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { user, can } = useAuth();
  const { config } = useConfig();
  if (user) return <Navigate to={homePath(can, config.modes)} replace />;
  return <Outlet />;
}

/** Gate a page by permission (any of) and optional mode flag. */
function Gate({ gates, mode, children }: { gates?: string[]; mode?: keyof Modes; children: ReactNode }) {
  const { can } = useAuth();
  const { config } = useConfig();
  if (mode && !config.modes[mode]) return <NotFound />;
  if (gates && gates.length && !can(...gates)) return <Forbidden />;
  return <>{children}</>;
}

function Home() {
  const { user, can } = useAuth();
  const { config } = useConfig();
  if (!user) return <Navigate to="/auth/login" replace />;
  return <Navigate to={homePath(can, config.modes)} replace />;
}

const gatesFor = (to: string) => navGroups.flatMap((g) => g.items).find((i) => i.to === to);
const guarded = (to: string, el: ReactNode, extraGates?: string[]) => {
  const item = gatesFor(to);
  return <Gate gates={extraGates ?? item?.gates} mode={item?.mode}>{el}</Gate>;
};

export const router = createBrowserRouter([
  { path: '/', element: <Home />, errorElement: <RouteError /> },
  {
    path: '/auth',
    element: <GuestOnly />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="login" replace /> },
      { path: 'login', element: page(() => import('@/pages/auth/Login')) },
      { path: 'register', element: page(() => import('@/pages/auth/Register')) },
      { path: 'recover', element: page(() => import('@/pages/auth/Recover')) },
      { path: 'reset/:token', element: page(() => import('@/pages/auth/Reset')) },
    ],
  },
  // Public pages
  { path: '/dm', element: page(() => import('@/pages/digital-menu/DigitalMenu')), errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { path: '/print/sale/:uuid', element: page(() => import('@/pages/print/PrintSale')) },
      { path: '/print/reservation/:uuid', element: page(() => import('@/pages/print/PrintReservation')) },
      // Full-screen work surfaces
      { path: '/admin/pos/:uuid?', element: <Gate gates={['pos_portal']}>{page(() => import('@/pages/pos/Pos'))}</Gate> },
      { path: '/admin/kitchen-display', element: <Gate gates={['kitchen_portal']}>{page(() => import('@/pages/kitchen/KitchenDisplay'))}</Gate> },
      {
        path: '/admin',
        element: <AppShell />,
        children: [
          { index: true, element: <Home /> },
          { path: 'dashboard', element: guarded('/admin/dashboard', page(() => import('@/pages/dashboard/Dashboard'))) },
          { path: 'sales', element: guarded('/admin/sales', page(() => import('@/pages/sales/SalesList'))) },
          { path: 'sales/:uuid/view', element: guarded('/admin/sales', page(() => import('@/pages/sales/SaleView'))) },
          { path: 'cashbooks', element: guarded('/admin/cashbooks', page(() => import('@/pages/cashbooks/Cashbooks'))) },
          { path: 'cashbook/:uuid', element: guarded('/admin/cashbooks', page(() => import('@/pages/cashbooks/CashbookView'))) },
          // Rooms
          { path: 'reservations', element: guarded('/admin/reservations', page(() => import('@/pages/rooms/Reservations'))) },
          { path: 'reservations/new', element: guarded('/admin/reservations', page(() => import('@/pages/rooms/ReservationForm'))) },
          { path: 'reservations/:uuid/edit', element: guarded('/admin/reservations', page(() => import('@/pages/rooms/ReservationForm'))) },
          { path: 'reservations/:uuid/view', element: guarded('/admin/reservations', page(() => import('@/pages/rooms/ReservationView'))) },
          { path: 'guest-rooms', element: guarded('/admin/guest-rooms', page(() => import('@/pages/rooms/GuestRooms'))) },
          { path: 'booking-sources', element: guarded('/admin/booking-sources', page(() => import('@/pages/rooms/BookingSources'))) },
          { path: 'reservation-statuses', element: guarded('/admin/reservation-statuses', page(() => import('@/pages/rooms/ReservationStatuses'))) },
          // Catalog
          { path: 'products', element: guarded('/admin/products', page(() => import('@/pages/catalog/Products'))) },
          { path: 'products/new', element: guarded('/admin/products', page(() => import('@/pages/catalog/ProductForm'))) },
          { path: 'products/:uuid/edit', element: guarded('/admin/products', page(() => import('@/pages/catalog/ProductForm'))) },
          { path: 'categories', element: guarded('/admin/categories', page(() => import('@/pages/catalog/Categories'))) },
          { path: 'modifiers', element: guarded('/admin/modifiers', page(() => import('@/pages/catalog/Modifiers'))) },
          { path: 'ingredients', element: guarded('/admin/ingredients', page(() => import('@/pages/catalog/Ingredients'))) },
          // Expenses
          { path: 'expenses', element: guarded('/admin/expenses', page(() => import('@/pages/expenses/Expenses'))) },
          { path: 'expense-types', element: guarded('/admin/expense-types', page(() => import('@/pages/expenses/ExpenseTypes'))) },
          // People
          { path: 'customers', element: guarded('/admin/customers', page(() => import('@/pages/people/Customers'))) },
          { path: 'users', element: guarded('/admin/users', page(() => import('@/pages/people/Users'))) },
          { path: 'user-roles', element: guarded('/admin/user-roles', page(() => import('@/pages/people/UserRoles'))) },
          // Reports
          { path: 'overall-sale-report', element: guarded('/admin/overall-sale-report', page(() => import('@/pages/reports/OverallSaleReport'))) },
          { path: 'overall-expense-report', element: guarded('/admin/overall-expense-report', page(() => import('@/pages/reports/OverallExpenseReport'))) },
          { path: 'category-based-report', element: guarded('/admin/category-based-report', page(() => import('@/pages/reports/CategoryReport'))) },
          { path: 'most-sold-items-report', element: guarded('/admin/most-sold-items-report', page(() => import('@/pages/reports/MostSoldItemsReport'))) },
          { path: 'tax-report', element: guarded('/admin/tax-report', page(() => import('@/pages/reports/TaxReport'))) },
          { path: 'expense-report', element: guarded('/admin/expense-report', page(() => import('@/pages/reports/ExpenseReport'))) },
          { path: 'stock-alerts', element: guarded('/admin/stock-alerts', page(() => import('@/pages/reports/StockAlerts'))) },
          { path: 'expiry-alerts', element: guarded('/admin/expiry-alerts', page(() => import('@/pages/reports/ExpiryAlerts'))) },
          // Setup
          { path: 'service-tables', element: guarded('/admin/service-tables', page(() => import('@/pages/setup/ServiceTables'))) },
          { path: 'payment-methods', element: guarded('/admin/payment-methods', page(() => import('@/pages/setup/PaymentMethods'))) },
          { path: 'pickup-points', element: guarded('/admin/pickup-points', page(() => import('@/pages/setup/PickupPoints'))) },
          { path: 'imports-exports', element: guarded('/admin/imports-exports', page(() => import('@/pages/system/ImportsExports'))) },
          { path: 'languages', element: guarded('/admin/languages', page(() => import('@/pages/system/Languages'))) },
          { path: 'languages/new', element: guarded('/admin/languages', page(() => import('@/pages/system/LanguageForm'))) },
          { path: 'languages/:id/edit', element: guarded('/admin/languages', page(() => import('@/pages/system/LanguageForm'))) },
          { path: 'backup', element: guarded('/admin/backup', page(() => import('@/pages/system/Backups'))) },
          { path: 'activity-logs', element: guarded('/admin/activity-logs', page(() => import('@/pages/system/ActivityLogs'))) },
          { path: 'my-logs', element: page(() => import('@/pages/system/MyLogs')) },
          { path: 'account', element: page(() => import('@/pages/account/Account')) },
          { path: 'settings', element: guarded('/admin/settings', page(() => import('@/pages/settings/Settings'))) },
          { path: 'settings/:tab', element: guarded('/admin/settings', page(() => import('@/pages/settings/Settings'))) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export { FullScreenLoader };
