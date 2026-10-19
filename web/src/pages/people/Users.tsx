import { useState } from 'react';
import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useT } from '@/providers/AppProviders';
import { Badge, Select } from '@/components/ui';
import type { User } from '@/lib/types';
import { Thumb, useList } from '@/components/catalog/shared';

const avatarOf = (u: Pick<User, 'avatar' | 'gravatar'>) => (u.avatar && u.avatar !== 'gravatar' ? u.avatar : u.gravatar ?? null);

export default function Users() {
  const t = useT();
  const { can, user: me } = useAuth();
  const allowed = can('manage_users');
  const [role, setRole] = useState('');
  const roles = useList<{ id: number; name: string }>('admin/users/user/roles', { enabled: allowed });

  return (
    <CrudPage<User>
      title="Users"
      singular="User"
      description="Staff accounts and the role that controls what each one can access. Manage your own account from the account page."
      url="admin/users"
      permission="manage_users"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      // The show endpoint refuses your own user (same rule as the old UI).
      showUrl={(r) => `admin/users/${r.id}`}
      filterValues={{ role: role || undefined }}
      filters={
        <Select
          aria-label={t('Role')}
          wrapperClassName="w-full sm:w-48"
          options={roles.items.map((r) => ({ value: r.id, label: r.name }))}
          placeholder={t('All roles')}
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      }
      fields={[
        { name: 'name', label: 'Name', required: true, full: true },
        { name: 'email', label: 'Email', type: 'email', required: true, full: true },
        { name: 'password', label: 'Password', type: 'password', required: true, createOnly: true, help: 'Minimum 6 characters', full: true },
        {
          name: 'role_id',
          label: 'Role',
          type: 'select',
          required: true,
          optionsUrl: 'admin/users/user/roles',
          full: true,
        },
        { name: 'status', label: 'Active', type: 'switch', defaultValue: true, help: 'Inactive users cannot sign in' },
      ]}
      toForm={(r) => ({ id: r.id, name: r.name ?? '', email: r.email ?? '', role_id: r.role_id ?? r.role?.id ?? '', status: !!r.status })}
      toPayload={(v, editing) => {
        const p: Record<string, any> = { name: v.name, email: v.email, role_id: v.role_id, status: !!v.status };
        if (editing) p.id = v.id;
        else p.password = v.password;
        return p;
      }}
      columns={[
        {
          key: 'name',
          header: t('Name'),
          sortKey: 'name',
          cell: (r) => (
            <div className="flex items-center gap-3">
              <Thumb src={avatarOf(r)} size="h-8 w-8" rounded="rounded-full" />
              <div className="min-w-0">
                <span className="block font-medium">
                  {r.name}
                  {me?.id === r.id && <Badge tone="purple" className="ms-1.5">{t('You')}</Badge>}
                </span>
                <span className="block truncate text-xs text-slate-500">{r.email}</span>
              </div>
            </div>
          ),
        },
        { key: 'role', header: t('Role'), sortKey: 'role_id', cell: (r) => <Badge tone="blue">{r.role?.name ?? '—'}</Badge> },
        {
          key: 'status',
          header: t('Status'),
          sortKey: 'status',
          cell: (r) => (r.status ? <Badge tone="green">{t('Active')}</Badge> : <Badge tone="red">{t('Inactive')}</Badge>),
        },
        { key: 'created_at', header: t('Created at'), sortKey: 'created_at', className: 'whitespace-nowrap text-slate-500' },
      ]}
    />
  );
}
