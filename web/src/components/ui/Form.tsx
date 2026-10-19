import clsx from 'clsx';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function Field({
  label,
  error,
  help,
  children,
  className,
  htmlFor,
  required,
}: {
  label?: ReactNode;
  error?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  required?: boolean;
}) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ms-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="error-text" role="alert">{error}</p> : help ? <p className="help">{help}</p> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string; help?: ReactNode; wrapperClassName?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, help, className, wrapperClassName, id, required, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} error={error} help={help} htmlFor={inputId} className={wrapperClassName} required={required}>
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={!!error || undefined}
        className={clsx('input', error && 'input-error', className)}
        {...rest}
      />
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string; help?: ReactNode; wrapperClassName?: string };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, help, className, wrapperClassName, id, rows = 3, required, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} error={error} help={help} htmlFor={inputId} className={wrapperClassName} required={required}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        required={required}
        aria-invalid={!!error || undefined}
        className={clsx('input', error && 'input-error', className)}
        {...rest}
      />
    </Field>
  );
});

export type Option = { value: string | number; label: ReactNode; disabled?: boolean };
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label?: ReactNode;
  error?: string;
  help?: ReactNode;
  options: Option[];
  placeholder?: string;
  wrapperClassName?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, help, options, placeholder, className, wrapperClassName, id, required, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} error={error} help={help} htmlFor={inputId} className={wrapperClassName} required={required}>
      <select
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={!!error || undefined}
        className={clsx('input pe-8', error && 'input-error', className)}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={String(o.value)} value={o.value} disabled={o.disabled}>
            {o.label as any}
          </option>
        ))}
      </select>
    </Field>
  );
});

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={clsx('flex items-start justify-between gap-4', className)}>
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          {label && <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>}
          {description && <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>}
        </label>
      )}
      {/* On touch screens the button is a 40px-tall hit area around the 24px track. */}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="inline-flex shrink-0 items-center rounded-full disabled:opacity-50 pointer-coarse:-my-2 pointer-coarse:h-10"
      >
        <span
          className={clsx(
            'relative inline-flex h-6 w-11 items-center rounded-full transition',
            checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700',
          )}
        >
          <span
            className={clsx(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition',
              checked ? 'translate-x-[22px] rtl:translate-x-[-22px]' : 'translate-x-0.5 rtl:-translate-x-0.5',
            )}
          />
        </span>
      </button>
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  indeterminate?: boolean;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-10 pointer-coarse:min-w-10 pointer-coarse:justify-center', !label && 'pointer-coarse:-my-2', className)}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded-sm border-slate-300 text-brand-600 accent-brand-600 focus:ring-brand-500 dark:border-slate-600"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
