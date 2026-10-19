import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, fieldErrors, listItems, multipartUpdate, toFormData } from '@/lib/api';
import { useAuth, useT } from '@/providers/AppProviders';
import {
  Button,
  DataTable,
  Drawer,
  ImageInput,
  Input,
  PageHeader,
  SearchInput,
  Select,
  Switch,
  TablePagination,
  Textarea,
  useConfirm,
  useTableQuery,
  type Column,
  type Option,
} from '@/components/ui';
import { toast } from 'sonner';

export type FieldDef = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'textarea' | 'select' | 'switch' | 'image' | 'date' | 'time' | 'color' | 'password' | 'tel';
  required?: boolean;
  help?: string;
  placeholder?: string;
  /** Static options, or a URL returning a list ({items} or array) mapped through optionLabel/optionValue. */
  options?: Option[];
  optionsUrl?: string;
  optionLabel?: string | ((row: any) => string);
  optionValue?: string;
  step?: string;
  full?: boolean;
  defaultValue?: any;
  hidden?: (values: Record<string, any>) => boolean;
  /** Only shown when creating. */
  createOnly?: boolean;
};

function OptionsSelect({ field, value, onChange, error }: { field: FieldDef; value: any; onChange: (v: any) => void; error?: string }) {
  const t = useT();
  const q = useQuery({
    queryKey: [field.optionsUrl, 'options'],
    queryFn: async () => listItems<any>((await api.get(field.optionsUrl!, { params: { perPage: 1000 }, silent: true })).data),
    enabled: !!field.optionsUrl,
  });
  const label = field.optionLabel ?? 'name';
  const valueKey = field.optionValue ?? 'id';
  const options: Option[] =
    field.options ??
    (q.data ?? []).map((row) => ({
      value: row[valueKey],
      label: typeof label === 'function' ? label(row) : row[label] ?? row.title ?? row.name,
    }));
  return (
    <Select
      label={t(field.label)}
      required={field.required}
      error={error}
      help={field.help && t(field.help)}
      options={options}
      placeholder={t('Select')}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function FieldRenderer({
  field,
  values,
  setValue,
  errors,
  current,
}: {
  field: FieldDef;
  values: Record<string, any>;
  setValue: (name: string, v: any) => void;
  errors: Record<string, string>;
  current?: Record<string, any> | null;
}) {
  const t = useT();
  const type = field.type ?? 'text';
  const error = errors[field.name];
  const v = values[field.name];
  if (type === 'select') return <OptionsSelect field={field} value={v} onChange={(x) => setValue(field.name, x)} error={error} />;
  if (type === 'switch')
    return <Switch label={t(field.label)} description={field.help && t(field.help)} checked={!!v && v !== '0' && v !== 'false'} onChange={(x) => setValue(field.name, x)} />;
  if (type === 'textarea')
    return (
      <Textarea
        label={t(field.label)}
        required={field.required}
        error={error}
        help={field.help && t(field.help)}
        placeholder={field.placeholder && t(field.placeholder)}
        value={v ?? ''}
        onChange={(e) => setValue(field.name, e.target.value)}
      />
    );
  if (type === 'image')
    return (
      <ImageInput
        label={t(field.label)}
        value={v instanceof File ? v : null}
        currentUrl={typeof current?.[field.name] === 'string' ? current?.[field.name] : null}
        onChange={(f) => setValue(field.name, f)}
        error={error}
      />
    );
  return (
    <Input
      label={t(field.label)}
      type={type}
      step={field.step ?? (type === 'number' ? 'any' : undefined)}
      required={field.required}
      error={error}
      help={field.help && t(field.help)}
      placeholder={field.placeholder && t(field.placeholder)}
      value={v ?? ''}
      onChange={(e) => setValue(field.name, e.target.value)}
    />
  );
}

/**
 * Generic list + create/edit drawer for the simple admin resources
 * (payment methods, tables, pickup points, categories, ...).
 */
export function CrudPage<T extends Record<string, any>>({
  title,
  description,
  url,
  idKey = 'id',
  columns,
  fields,
  permission,
  multipart,
  bulkDeleteUrl,
  showUrl,
  toForm,
  toPayload,
  extraActions,
  filters,
  filterValues,
  singular,
  canCreate = true,
  canDelete = true,
  canEdit = true,
  drawerWidth,
  renderForm,
  deleteMessage,
}: {
  title: string;
  description?: string;
  url: string;
  idKey?: string;
  columns: Column<T>[];
  fields: FieldDef[];
  permission?: string;
  multipart?: boolean;
  bulkDeleteUrl?: string;
  /** Fetch the full record before editing (defaults to using the list row). */
  showUrl?: (row: T) => string;
  toForm?: (row: any) => Record<string, any>;
  toPayload?: (values: Record<string, any>, editing: boolean) => Record<string, any>;
  extraActions?: ReactNode;
  filters?: ReactNode;
  filterValues?: Record<string, any>;
  singular?: string;
  canCreate?: boolean;
  /** true/false for every row, or a per-row check. */
  canDelete?: boolean | ((row: T) => boolean);
  canEdit?: boolean | ((row: T) => boolean);
  /** Text of the delete confirmation. */
  deleteMessage?: string;
  drawerWidth?: string;
  /** Replace the generated fields with a custom form body. */
  renderForm?: (p: { values: Record<string, any>; setValue: (n: string, v: any) => void; errors: Record<string, string>; current: any }) => ReactNode;
}) {
  const t = useT();
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const table = useTableQuery<T>(url, { filters: filterValues });
  const [selected, setSelected] = useState<(string | number)[]>([]);
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const allowed = !permission || can(permission);

  const defaults = () => Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === 'switch' ? false : '')]));

  const openCreate = () => {
    setEditing(null);
    setValues(defaults());
    setErrors({});
    setOpen(true);
  };
  const openEdit = async (row: T) => {
    let record: any = row;
    if (showUrl) {
      try {
        record = (await api.get(showUrl(row))).data;
      } catch {
        return;
      }
    }
    setEditing(record);
    const base = defaults();
    const mapped = toForm ? toForm(record) : record;
    const v: Record<string, any> = { ...base };
    for (const f of fields) if (mapped[f.name] !== undefined && f.type !== 'image' && f.type !== 'password') v[f.name] = mapped[f.name];
    setValues({ ...v, ...(toForm ? mapped : {}) });
    setErrors({});
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const isEdit = !!editing;
      const raw = { ...values };
      for (const f of fields) if (f.type === 'image' && !(raw[f.name] instanceof File)) delete raw[f.name];
      const payload = toPayload ? toPayload(raw, isEdit) : raw;
      if (isEdit) {
        const target = `${url}/${editing![idKey]}`;
        return multipart ? multipartUpdate(target, payload) : api.patch(target, payload);
      }
      return multipart ? api.post(url, toFormData(payload)) : api.post(url, payload);
    },
    onSuccess: (res) => {
      toast.success(res.data?.message ?? t('Data saved successfully'));
      setOpen(false);
      qc.invalidateQueries({ queryKey: [url] });
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const remove = async (row: T) => {
    if (!(await confirm({ danger: true, message: deleteMessage ? t(deleteMessage) : undefined }))) return;
    const res = await api.delete(`${url}/${row[idKey]}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    qc.invalidateQueries({ queryKey: [url] });
  };

  const removeSelected = async () => {
    if (!bulkDeleteUrl || !selected.length) return;
    if (!(await confirm({ danger: true, message: t(':count items will be removed', { count: selected.length }) }))) return;
    const res = await api.delete(bulkDeleteUrl, { data: { rows: selected } });
    toast.success(res.data?.message ?? t('Data removed successfully'));
    setSelected([]);
    qc.invalidateQueries({ queryKey: [url] });
  };

  useEffect(() => setSelected([]), [table.page]);

  if (!allowed) return <p className="text-sm text-slate-500">{t('You have not permit to perform this request')}</p>;

  const allColumns: Column<T>[] = [
    ...columns,
    {
      key: '__actions',
      header: <span className="sr-only">{t('Actions')}</span>,
      headerClassName: 'w-24',
      className: 'text-end',
      cell: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {(typeof canEdit === 'function' ? canEdit(row) : canEdit) && (
            <button className="btn-ghost btn-sm" onClick={() => openEdit(row)} aria-label={t('Edit')} title={t('Edit')}>
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {(typeof canDelete === 'function' ? canDelete(row) : canDelete) && (
            <button className="btn-ghost btn-sm text-red-600" onClick={() => remove(row)} aria-label={t('Delete')} title={t('Delete')}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const setValue = (n: string, v: any) => setValues((s) => ({ ...s, [n]: v }));

  return (
    <div>
      <PageHeader
        title={t(title)}
        description={description && t(description)}
        actions={
          <>
            {extraActions}
            {canCreate && (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                {t('Add new')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput className="w-full sm:w-72" value={table.search} onChange={table.setSearch} />
        {filters}
        {bulkDeleteUrl && selected.length > 0 && (
          <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={removeSelected}>
            {t('Delete')} ({selected.length})
          </Button>
        )}
      </div>
      <DataTable
        columns={allColumns}
        rows={table.items}
        loading={table.query.isLoading}
        rowKey={(r) => r[idKey]}
        sort={table.sort}
        onSort={table.setSort}
        selectable={!!bulkDeleteUrl}
        selected={selected}
        onSelectedChange={setSelected}
        onRowClick={canEdit ? (row) => (typeof canEdit === 'function' && !canEdit(row) ? undefined : openEdit(row)) : undefined}
        footer={<TablePagination table={table} />}
      />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width={drawerWidth}
        title={editing ? `${t('Edit')} ${t(singular ?? title)}` : `${t('Add new')} ${t(singular ?? title)}`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('Cancel')}</Button>
            <Button variant="primary" type="submit" form="crud-form" loading={save.isPending}>
              {t('Save')}
            </Button>
          </>
        }
      >
        <form
          id="crud-form"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {renderForm
            ? renderForm({ values, setValue, errors, current: editing })
            : fields
                .filter((f) => !(f.hidden?.(values)) && !(f.createOnly && editing))
                .map((f) => (
                  <div key={f.name} className={f.full || f.type === 'textarea' || f.type === 'switch' ? 'sm:col-span-2' : ''}>
                    <FieldRenderer field={f} values={values} setValue={setValue} errors={errors} current={editing} />
                  </div>
                ))}
        </form>
      </Drawer>
    </div>
  );
}
