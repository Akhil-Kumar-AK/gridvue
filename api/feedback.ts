/**
 * Vercel serverless function for the feedback button in the browser-only demo.
 * Everything else in the demo runs inside the visitor's browser; this is the one thing that needs a server (to send email).
 * Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM and FEEDBACK_TO in the Vercel project's environment variables.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mailConfig, sendMail, type Attachment } from '../apps/server/src/mailer';

type Req = IncomingMessage & { body?: any };
const send = (res: ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const sniff = (b: Buffer): string | null => {
  if (b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
};

export default async function handler(req: Req, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, 5000) : '';
  if (!name) return send(res, 400, { error: 'Invalid name' });
  if (!message) return send(res, 400, { error: 'Invalid message' });
  const kind = ['bug', 'idea', 'other'].includes(b.kind) ? (b.kind as string) : 'other';
  const page = typeof b.page === 'string' ? b.page.slice(0, 500) : '';
  const ua = typeof b.userAgent === 'string' ? b.userAgent.slice(0, 300) : String(req.headers['user-agent'] ?? '').slice(0, 300);
  const shots: Attachment[] = [];
  for (const [i, s] of (Array.isArray(b.screenshots) ? b.screenshots : []).slice(0, 3).entries()) {
    const data = Buffer.from(String(s?.base64 ?? ''), 'base64');
    const mime = sniff(data); if (!mime) return send(res, 400, { error: 'Screenshots must be PNG, JPEG, GIF or WebP images' });
    shots.push({ filename: `screenshot-${i + 1}.${mime.split('/')[1].replace('jpeg', 'jpg')}`, mime, data });
  }
  const cfg = mailConfig();
  if (!cfg) return send(res, 200, { ok: true, emailed: false, configured: false });
  const label = ({ bug: 'Bug', idea: 'Idea', other: 'Feedback' } as Record<string, string>)[kind];
  const text = [`${label} from ${name}`, '', message, '', '— Details —', `Name entered: ${name}`, `Type: ${label}`, `Page: ${page || '(unknown)'}`, `Browser: ${ua}`, 'Source: browser-only demo'].join('\n');
  try { await sendMail(cfg, `[Gridvue ${label}] ${name}: ${message.replace(/\s+/g, ' ').slice(0, 60)}`, text, shots); return send(res, 200, { ok: true, emailed: true, configured: true }); }
  catch (e) { console.error('Feedback email failed:', (e as Error).message); return send(res, 200, { ok: true, emailed: false, configured: true }); }
}
