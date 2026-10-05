/** Thin fetch wrapper for the MMC Core API (same origin, cookie session). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login') && !/^\/(q|p|sign)\//.test(location.pathname)) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const details = body?.details;
    const detailMsg = Array.isArray(details) ? details.map((d: { path?: string; message?: string }) => `${d.path ? `${d.path}: ` : ''}${d.message}`).join(' · ') : '';
    throw new ApiError([body?.message ?? `HTTP ${res.status}`, detailMsg].filter(Boolean).join(' — '), res.status, details);
  }
  return body as T;
}

export const api = {
  get: <T = any>(path: string) => fetch(`/api${path}`, { credentials: 'include' }).then((r) => handle<T>(r)),
  post: <T = any>(path: string, body?: unknown) => fetch(`/api${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  put: <T = any>(path: string, body: unknown) => fetch(`/api${path}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  patch: <T = any>(path: string, body: unknown) => fetch(`/api${path}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  del: <T = any>(path: string) => fetch(`/api${path}`, { method: 'DELETE', credentials: 'include' }).then((r) => handle<T>(r)),
};

/** Query string from an object, skipping empty values. */
export function qs(params: Record<string, unknown>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Open a file endpoint (PDF/Excel) in a new tab. */
export function openFile(path: string) {
  window.open(`/api${path}`, '_blank', 'noopener');
}
