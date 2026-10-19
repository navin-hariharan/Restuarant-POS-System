import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';

// Same key the previous release used, so people stay signed in after the upgrade.
export const TOKEN_KEY = 'token';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    Accept: 'application/json',
    // The API only answers XHR-flagged requests.
    'X-Requested-With': 'XMLHttpRequest',
  },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type Unauthorized = () => void;
let onUnauthorized: Unauthorized | null = null;
export function setUnauthorizedHandler(fn: Unauthorized | null) {
  onUnauthorized = fn;
}

type DataChanged = (url: string) => void;
const changeListeners = new Set<DataChanged>();
/** Called after every successful request that changed data on the server. */
export function onDataChanged(fn: DataChanged): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

/** Requests that are sent with POST but only read (sign-in, checks, reports, exports). */
const READ_ONLY = /^(auth\/(login|check|recover|register|reset)|admin\/report-|admin\/exports)/;

function notifyChange(config: { method?: string; url?: string; readOnly?: boolean }) {
  const method = (config.method ?? 'get').toLowerCase();
  if (method === 'get' || method === 'head' || method === 'options' || config.readOnly) return;
  const url = (config.url ?? '').replace(/^\/+/, '');
  if (READ_ONLY.test(url)) return;
  for (const fn of changeListeners) fn(url);
}

api.interceptors.response.use(
  (response) => {
    notifyChange(response.config);
    return response;
  },
  (error: AxiosError<any>) => {
    const status = error.response?.status;
    const config: any = error.config ?? {};
    if (status === 401 && getToken() && !config.skipAuthRedirect) {
      clearToken();
      onUnauthorized?.();
    }
    if (!config.silent) {
      const message = errorMessage(error);
      if (message) toast.error(message);
    }
    return Promise.reject(error);
  },
);

/** Human readable message from an API error response. */
export function errorMessage(error: unknown): string {
  const err = error as AxiosError<any>;
  const data = err?.response?.data;
  if (data?.errors && typeof data.errors === 'object') {
    const first = Object.values(data.errors)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
  }
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (typeof data?.error === 'string' && data.error) return data.error;
  if (err?.response?.status === 403) return 'You have not permit to perform this request';
  if (!err?.response && err?.message) return err.message;
  return '';
}

/** Validation errors keyed by field (422 responses). */
export function fieldErrors(error: unknown): Record<string, string> {
  const data = (error as AxiosError<any>)?.response?.data;
  const out: Record<string, string> = {};
  if (data?.errors && typeof data.errors === 'object') {
    for (const [key, val] of Object.entries(data.errors)) {
      out[key] = Array.isArray(val) ? String(val[0]) : String(val);
    }
  }
  return out;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable */
  }
}
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Build multipart form data; booleans become "true"/"false" like the old UI sent them. */
export function toFormData(values: Record<string, any>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value instanceof File || value instanceof Blob) fd.append(key, value);
    else if (value === null) fd.append(key, 'null');
    else if (typeof value === 'object') fd.append(key, JSON.stringify(value));
    else fd.append(key, String(value));
  }
  return fd;
}

/** Trigger a browser download for a blob response. */
export function downloadBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type Paginated<T> = {
  items: T[];
  pagination: { currentPage: number; perPage: number; total: number; totalPages: number };
};

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Don't toast errors for this request. */
    silent?: boolean;
    /** Don't log the user out on 401 (used by login forms). */
    skipAuthRedirect?: boolean;
    /** A POST/PUT that only reads: screens are not refreshed after it. */
    readOnly?: boolean;
  }
}

/** Update with files: a real multipart PATCH request. */
export function multipartUpdate(url: string, values: Record<string, any>) {
  return api.patch(url, toFormData(values));
}

/** Lists come back either paginated ({items, pagination}) or as a plain array. */
export function listItems<T>(data: Paginated<T> | T[] | undefined | null): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.items ?? [];
}
