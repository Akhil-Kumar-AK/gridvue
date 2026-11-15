import type { BoardData, DocumentData, NativeFile } from '@layr/core';
import { apiFetch } from './net';

export interface User { id: string; email: string; name: string }
export interface FileMeta {
  id: string; name: string; type: string; projectId: string | null; ownerId: string; ownerName: string;
  role: 'owner' | 'editor' | 'viewer'; revision: number; createdAt: number; updatedAt: number; deletedAt: number | null;
  hasThumbnail: boolean; favorite: boolean;
  /** design file: the design system (file of type 'designsystem') linked as its component library */
  libraryId?: string | null;
}
export class ApiError extends Error { constructor(public status: number, message: string, public body: any = {}) { super(message); } }

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob | ArrayBuffer, extra: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), ...extra });
  } catch { throw new ApiError(0, 'Network error: cannot reach the server'); }
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`, json);
  return json as T;
}

export const api = {
  me: () => call<{ user: User; workspace: { id: string; name: string } }>('GET', '/api/me'),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { email, password }),
  register: (email: string, name: string, password: string) => call<{ user: User }>('POST', '/api/auth/register', { email, name, password }),
  enter: (name: string) => call<{ user: User }>('POST', '/api/auth/enter', { name }),
  logout: () => call('POST', '/api/auth/logout', {}),
  listFiles: (params: Record<string, string>) => call<{ files: FileMeta[] }>('GET', '/api/files?' + new URLSearchParams(params)),
  createFile: (body: { name?: string; type?: 'design' | 'whiteboard' | 'designsystem'; projectId?: string | null; import?: unknown }) => call<{ file: FileMeta }>('POST', '/api/files', body),
  getFile: (id: string) => call<{ file: FileMeta; role: FileMeta['role']; document: DocumentData & BoardData }>('GET', `/api/files/${id}`),
  saveDoc: (id: string, baseRevision: number, doc: DocumentData | BoardData, keepalive = false) => call<{ revision: number }>('PUT', `/api/files/${id}/doc`, { baseRevision, doc }, undefined, { keepalive }),
  setLibrary: (fileId: string, libraryId: string | null) => call<{ file: FileMeta }>('PATCH', `/api/files/${fileId}`, { libraryId }),
  patchFile: (id: string, body: Record<string, unknown>) => call<{ file: FileMeta }>('PATCH', `/api/files/${id}`, body),
  duplicate: (id: string) => call<{ file: FileMeta }>('POST', `/api/files/${id}/duplicate`, {}),
  trash: (id: string) => call('DELETE', `/api/files/${id}`),
  restore: (id: string) => call('POST', `/api/files/${id}/restore`, {}),
  deleteForever: (id: string) => call('DELETE', `/api/files/${id}?permanent=1`),
  uploadAsset: (fileId: string, blob: Blob) => call<{ assetId: string; mime: string }>('POST', `/api/files/${fileId}/assets`, undefined, blob),
  deleteThumbnail: (fileId: string) => call('DELETE', `/api/files/${fileId}/thumbnail`),
  uploadThumbnail: (fileId: string, blob: Blob) => call('PUT', `/api/files/${fileId}/thumbnail`, undefined, blob),
  projects: () => call<{ projects: { id: string; name: string }[] }>('GET', '/api/projects'),
  createProject: (name: string) => call<{ project: { id: string; name: string } }>('POST', '/api/projects', { name }),
  renameProject: (id: string, name: string) => call('PATCH', `/api/projects/${id}`, { name }),
  deleteProject: (id: string) => call('DELETE', `/api/projects/${id}`),
  sendFeedback: (body: { name: string; kind: 'bug' | 'idea' | 'other'; message: string; page: string; userAgent: string; screenshots: { base64: string }[] }) => call<{ ok: boolean; emailed: boolean; configured: boolean }>('POST', '/api/feedback', body),
  members: (id: string) => call<{ owner: User; members: (User & { role: 'editor' | 'viewer' })[] }>('GET', `/api/files/${id}/members`),
  addMember: (id: string, email: string, role: 'editor' | 'viewer') => call('POST', `/api/files/${id}/members`, { email, role }),
  removeMember: (id: string, userId: string) => call('DELETE', `/api/files/${id}/members/${userId}`),
};

export async function buildNativeFile(file: FileMeta, doc: DocumentData): Promise<NativeFile> {
  const assets: NativeFile['assets'] = {};
  for (const id of Object.keys(doc.assets)) {
    const r = await apiFetch(`/api/assets/${id}`);
    if (!r.ok) throw new Error(`Could not fetch asset ${id} for export`);
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    assets[id] = { mime: r.headers.get('content-type') ?? 'application/octet-stream', base64: btoa(bin) };
  }
  return { format: 'layr-document', schemaVersion: doc.schemaVersion, name: file.name, exportedAt: new Date().toISOString(), document: doc, assets };
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
