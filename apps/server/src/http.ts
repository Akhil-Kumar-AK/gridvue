import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error { constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); } }

export interface Ctx { req: IncomingMessage; res: ServerResponse; url: URL; params: Record<string, string>; userId: string | null }
export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route { method: string; re: RegExp; keys: string[]; handler: Handler; auth: boolean }

export class Router {
  routes: Route[] = [];
  add(method: string, path: string, auth: boolean, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler, auth });
  }
  match(method: string, pathname: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
  allowed(pathname: string) { return this.routes.some(r => r.re.test(pathname)); }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0, over = false;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) { over = true; continue; } // keep reading (and discarding) so the 413 reaches the client instead of a reset connection
    chunks.push(c as Buffer);
  }
  if (over) throw new HttpError(413, `Body is ${(size / 1e6).toFixed(1)} MB; the limit is ${(limit / 1e6).toFixed(0)} MB`);
  return Buffer.concat(chunks);
}

export async function readJson<T = any>(req: IncomingMessage, limit: number): Promise<T> {
  const buf = await readBody(req, limit);
  if (!buf.length) return {} as T;
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
