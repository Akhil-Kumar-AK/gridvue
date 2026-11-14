import { ByteBuffer, compileSchema, decodeBinarySchema } from 'kiwi-schema';
import { inflateSync } from 'fflate';
import { decompress as unzstd } from 'fzstd';

/** The parts of a Figma clipboard message we use (field names follow Figma's kiwi schema). */
export interface FigmaMessage { nodeChanges: any[]; blobs: { bytes: Uint8Array }[] }

const b64 = (s: string): Uint8Array => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

/** Figma puts layers on the clipboard as HTML: `<span data-buffer="<!--(figma)BASE64-->">`. */
export function figmaBufferFromHtml(html: string): Uint8Array | null {
  const m = /\(figma\)([A-Za-z0-9+/=]+)/.exec(html);
  if (!m) return null;
  try { return b64(m[1]); } catch { return null; }
}
export const looksLikeFigma = (html: string | undefined | null) => !!html && /\(figma\)[A-Za-z0-9+/=]{16,}/.test(html);

const isZstd = (c: Uint8Array) => c.length > 4 && c[0] === 0x28 && c[1] === 0xb5 && c[2] === 0x2f && c[3] === 0xfd;
const inflate = (c: Uint8Array) => (isZstd(c) ? unzstd(c) : inflateSync(c));

/** Split the fig-kiwi container, decompress the schema and the data, and decode the message with that schema. */
export function decodeFigmaBuffer(buf: Uint8Array): FigmaMessage {
  const magic = String.fromCharCode(...buf.subarray(0, 8));
  if (!magic.startsWith('fig-')) throw new Error('Not a Figma clipboard buffer');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chunks: Uint8Array[] = [];
  let off = 12;
  while (off + 4 <= buf.length) { const len = dv.getUint32(off, true); off += 4; if (len === 0 || off + len > buf.length) break; chunks.push(buf.subarray(off, off + len)); off += len; }
  if (chunks.length < 2) throw new Error('Figma clipboard buffer is incomplete');
  const schema = compileSchema(decodeBinarySchema(new ByteBuffer(inflate(chunks[0]))));
  const msg = (schema as any).decodeMessage(inflate(chunks[1]));
  return { nodeChanges: msg.nodeChanges ?? [], blobs: msg.blobs ?? [] };
}
