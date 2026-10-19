import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, fieldErrors } from '@/lib/api';
import type { Role } from '@/lib/types';
import { useAuth, useT } from '@/providers/AppProviders';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  Input,
  PageHeader,
  SearchInput,
  Skeleton,
  TablePagination,
  useConfirm,
  useTableQuery,
  type Column,
} from '@/components/ui';

type PermissionEntry = { key?: string; label: string; title?: boolean };
type Group = { label: string; items: { key: string; label: string }[] };

/** Split the flat permission list (with `title` separators) into sections. */
function groupPermissions(list: PermissionEntry[], firstLabel: string): Group[] {
  const groups: Group[] = [];
  let current: Group = { label: firstLabel, items: [] };
  for (const p of list) {
    if (p.title) {
      if (current.items.length) groups.push(current);
      current = { label: p.label, items: [] };
    } else if (p.key) current.items.push({ key: p.key, label: p.label });
  }
  if (current.items.length) groups.push(current);
  return groups;
}

function PermissionMatrix({ groups, value, onChange }: { groups: Group[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const selected = new Set(value);
  const allKeys = groups.flatMap((g) => g.items.map((i) => i.key));
  const q = filter.trim().toLowerCase();
  const visible = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((i) => i.label.toLowerCase().includes(q) || i.key.includes(q) || g.label.toLowerCase().includes(q)) : g.items }))
    .filter((g) => g.items.length);

  const toggleMany = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    onChange(allKeys.filter((k) => next.has(k)).concat(value.filter((k) => !allKeys.includes(k))));
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput className="w-full sm:w-64" value={filter} onChange={setFilter} placeholder={t('Filter permissions')} />
        <span className="text-sm text-slate-500">
          {t(':count of :total selected', { count: allKeys.filter((k) => selected.has(k)).length, total: allKeys.length })}
        </span>
        <div className="ms-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleMany(allKeys, true)}>
            {t('Select all')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toggleMany(allKeys, false)}>
            {t('Clear all')}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((g) => {
          const keys = g.items.map((i) => i.key);
          const count = keys.filter((k) => selected.has(k)).length;
          const all = count === keys.length;
          return (
            <fieldset key={g.label} className="rounded-lg border border-slate-200 dark:border-slate-800">
              <legend className="sr-only">{g.label}</legend>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
                <Checkbox
                  label={<span className="font-semibold">{g.label}</span>}
                  checked={all}
                  indeterminate={count > 0 && !all}
                  onChange={(on) => toggleMany(keys, on)}
                  aria-label={`${t('Select all')}: ${g.label}`}
                />
                <span className={clsx('text-xs tabular-nums', count ? 'text-brand-600' : 'text-slate-400')}>
                  {count}/{keys.length}
                </span>
              </div>
              <ul className="grid gap-1 p-3 sm:grid-cols-1">
                {g.items.map((i) => (
                  <li key={i.key}>
                    <Checkbox
                      className="w-full rounded-sm px-1 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      label={<span>{i.label}</span>}
                      checked={selected.has(i.key)}
                      onChange={(on) => toggleMany([i.key], on)}
                    />
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
        {!visible.length && <p className="text-sm text-slate-500">{t('No data found')}</p>}
      </div>
    </div>
  );
}

export default function UserRoles() {
  const t = useT();
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const allowed = can('manage_user_roles');
  const table = useTableQuery<Role>('admin/user-roles');
  const permissions = useQuery({
    queryKey: ['admin/roles/permissions'],
    queryFn: async () => (await api.get<PermissionEntry[]>('admin/roles/permissions')).data,
    staleTime: Infinity,
  });
  const groups = useMemo(() => groupPermissions(permissions.data ?? [], t('Dashboard and sales')), [permissions.data, t]);
  const labelOf = useMemo(() => new Map(groups.flatMap((g) => g.items.map((i) => [i.key, i.label] as const))), [groups]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const openForm = (role: Role | null) => {
    setEditing(role);
    setName(role?.name ?? '');
    setPerms(Array.isArray(role?.permissions) ? [...role!.permissions] : []);
    setErrors({});
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), permissions: perms };
      return editing ? api.patch(`admin/user-roles/${editing.id}`, { id: editing.id, ...body }) : api.post('admin/user-roles', body);
    },
    onSuccess: (res) => {
      toast.success(res.data?.message ?? t('Data saved successfully'));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['admin/user-roles'] });
      qc.invalidateQueries({ queryKey: ['admin/users/user/roles'] });
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const remove = async (role: Role) => {
    const ok = await confirm({
      danger: true,
      title: t('Delete user role'),
      message: `${t('Are you sure you want to delete the user role?')} ${role.users ? t('All users with this role will be moved to the default role') : ''}`,
    });
    if (!ok) return;
    const res = await api.delete(`admin/user-roles/${role.id}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    qc.invalidateQueries({ queryKey: ['admin/user-roles'] });
  };

  const columns: Column<Role>[] = [
    {
      key: 'name',
      header: t('Name'),
      sortKey: 'name',
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
          {r.is_primary ? <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
          {r.name}
          {r.is_primary && <Badge tone="purple">{t('System')}</Badge>}
        </span>
      ),
    },
    {
      key: 'permissions',
      header: t('Permissions'),
      cell: (r) => {
        if (r.is_primary && r.id === 1) return <Badge tone="green">{t('Full access')}</Badge>;
        const list = Array.isArray(r.permissions) ? r.permissions : [];
        if (!list.length) return <span className="text-slate-400">—</span>;
        return (
          <div className="flex max-w-xl flex-wrap gap-1">
            {list.slice(0, 4).map((p) => (
              <Badge key={p}>{labelOf.get(p) ?? p}</Badge>
            ))}
            {list.length > 4 && <Badge tone="blue">+{list.length - 4}</Badge>}
          </div>
        );
      },
    },
    { key: 'users', header: t('Users'), className: 'text-center tabular-nums', headerClassName: 'text-center', cell: (r) => r.users ?? 0 },
    {
      key: '__actions',
      header: <span className="sr-only">{t('Actions')}</span>,
      className: 'text-end',
      cell: (r) =>
        allowed && !r.is_primary ? (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <button className="btn-ghost btn-sm" onClick={() => openForm(r)} aria-label={`${t('Edit')} ${r.name}`} title={t('Edit')}>
              <Pencil className="h-4 w-4" />
            </button>
            <button className="btn-ghost btn-sm text-red-600" onClick={() => remove(r)} aria-label={`${t('Delete')} ${r.name}`} title={t('Delete')}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-400" title={t('Cannot edit a system base function')}>
            <Lock className="ms-auto h-4 w-4" aria-label={t('Cannot edit a system base function')} />
          </span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('User roles')}
        description={t('Sections of the application permission')}
        actions={
          allowed && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openForm(null)}>
              {t('Create user role')}
            </Button>
          )
        }
      />
      <div className="mb-3">
        <SearchInput className="w-full sm:w-72" value={table.search} onChange={table.setSearch} />
      </div>
      <DataTable
        columns={columns}
        rows={table.items}
        loading={table.query.isLoading}
        rowKey={(r) => r.id}
        sort={table.sort}
        onSort={table.setSort}
        onRowClick={allowed ? (r) => !r.is_primary && openForm(r) : undefined}
        footer={<TablePagination table={table} />}
      />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-4xl"
        title={editing ? t('Edit user role') : t('Create user role')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('Cancel')}</Button>
            <Button variant="primary" type="submit" form="role-form" loading={save.isPending}>
              {t('Save')}
            </Button>
          </>
        }
      >
        <form
          id="role-form"
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input label={t('Name')} required value={name} error={errors.name} onChange={(e) => setName(e.target.value)} />
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t('Permissions')}</h3>
            <p className="help mb-3">{t('Choose which sections of the application users with this role can access.')}</p>
            {errors.permissions && <p className="error-text mb-2">{errors.permissions}</p>}
            {permissions.isLoading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-40" />
                ))}
              </div>
            ) : (
              <PermissionMatrix groups={groups} value={perms} onChange={setPerms} />
            )}
          </div>
        </form>
      </Drawer>
    </div>
  );
}
