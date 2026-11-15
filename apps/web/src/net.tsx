import { useEffect, useState } from 'react';

/** True in the browser-only demo build (`npm run build:demo`): the API runs inside the page and nothing is sent to a server. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

/** fetch for the Gridvue API. In the demo build `/api/*` is answered by the in-browser backend (feedback still goes to the host's function). */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!DEMO || path.startsWith('/api/feedback')) return fetch(path, init);
  const { demoHandle } = await import('./demo/backend');
  const url = new URL(path, location.origin);
  let body: unknown, raw: Blob | undefined;
  if (init.body instanceof Blob) raw = init.body;
  else if (init.body instanceof ArrayBuffer) raw = new Blob([init.body]);
  else if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { /* not JSON */ } }
  const r = await demoHandle((init.method ?? 'GET').toUpperCase(), url, body, raw);
  if (r.blob) return new Response(r.blob, { status: r.status, headers: { 'content-type': r.blob.type } });
  return new Response(JSON.stringify(r.json ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
}

const urlCache = new Map<string, Promise<string | null>>();
/** Object URL for a protected API resource (image assets, thumbnails). Cached per path. */
export function objectUrl(path: string): Promise<string | null> {
  let p = urlCache.get(path);
  if (!p) { p = apiFetch(path).then(r => (r.ok ? r.blob() : null)).then(b => (b ? URL.createObjectURL(b) : null)).catch(() => null); urlCache.set(path, p); }
  return p;
}
export function useObjectUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; setUrl(null); if (path) void objectUrl(path).then(u => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [path]);
  return url;
}
/** <img> for a protected API path (works in the demo build, where there is no server URL to point at). */
export function ApiImg({ path, alt = '', ...rest }: { path: string; alt?: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const url = useObjectUrl(path);
  return url ? <img src={url} alt={alt} {...rest} /> : <span className="hph" />;
}
