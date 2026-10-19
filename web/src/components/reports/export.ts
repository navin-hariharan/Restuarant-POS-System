import { downloadBlob } from '@/lib/api';

/** yyyy-mm-dd_hh-mm-ss, used in exported file names. */
export function fileStamp(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

/** Build a CSV (with UTF-8 BOM so Excel opens non-latin text correctly) and download it. */
export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const body = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${name}_${fileStamp()}.csv`);
}

/**
 * Print a single element: it is cloned into a hidden iframe that carries the app's stylesheets,
 * so the sidebar/header of the shell never end up on paper.
 */
export function printElement(el: HTMLElement | null, title = document.title) {
  if (!el) return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join('\n');
  const dir = document.documentElement.dir || 'ltr';
  const lang = document.documentElement.lang || 'en';
  doc.open();
  doc.write(
    `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>${styles}
<style>
  body{background:#fff!important;color:#0f172a!important;padding:16px;font-size:12px}
  .no-print,[data-no-print]{display:none!important}
  .card{box-shadow:none!important;break-inside:avoid}
  table{page-break-inside:auto} tr{page-break-inside:avoid}
  .overflow-x-auto,.overflow-y-auto,.overflow-auto{overflow:visible!important;max-height:none!important}
  @page{margin:12mm}
</style></head><body>${el.outerHTML}</body></html>`,
  );
  doc.close();
  const go = () => {
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  // Give linked stylesheets a moment to load.
  if (doc.readyState === 'complete') setTimeout(go, 250);
  else iframe.onload = () => setTimeout(go, 250);
}
