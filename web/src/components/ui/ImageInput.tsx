import { ImagePlus, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useT } from '@/providers/AppProviders';

/** Pick an image file; shows the current URL or the picked file as preview. */
export function ImageInput({
  label,
  value,
  currentUrl,
  onChange,
  error,
  accept = 'image/*',
}: {
  label?: string;
  value: File | null | undefined;
  currentUrl?: string | null;
  onChange: (f: File | null) => void;
  error?: string;
  accept?: string;
}) {
  const t = useT();
  const id = useId();
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  const src = preview ?? currentUrl ?? null;
  return (
    <div>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-3">
        <label
          htmlFor={id}
          className="flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
        >
          {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" />}
        </label>
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          <label htmlFor={id} className="btn-secondary btn-sm cursor-pointer">
            {t('Choose file')}
          </label>
          {value && (
            <button type="button" className="tap inline-flex items-center gap-1 text-red-600" onClick={() => onChange(null)}>
              <X className="h-3 w-3" /> {t('Remove')}
            </button>
          )}
        </div>
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            onChange(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
