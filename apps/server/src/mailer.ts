import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

/** SMTP settings come from the environment; with no SMTP_HOST the mailer is "not configured" and callers keep the message locally. */
export interface MailConfig { host: string; port: number; secure: boolean; /** upgrade a plain connection with STARTTLS (default; SMTP_STARTTLS=0 for a local relay) */ starttls: boolean; user?: string; pass?: string; from: string; to: string }
export const mailConfig = (): MailConfig | null => {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  return { host, port, secure: process.env.SMTP_SECURE === '1' || port === 465, starttls: process.env.SMTP_STARTTLS !== '0', user, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM?.trim() || user || 'feedback@localhost', to: process.env.FEEDBACK_TO?.trim() || 'akhilkumar.uxuidesigner@outlook.com' };
};

export interface Attachment { filename: string; mime: string; data: Buffer }
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const b64lines = (b: Buffer) => b.toString('base64').replace(/(.{76})/g, '$1\r\n');

export function buildMessage(c: Pick<MailConfig, 'from' | 'to'>, subject: string, text: string, attachments: Attachment[]): string {
  const boundary = `=_${randomUUID()}`;
  const head = [`From: ${clean(c.from)}`, `To: ${clean(c.to)}`, `Subject: =?UTF-8?B?${Buffer.from(clean(subject)).toString('base64')}?=`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`].join('\r\n');
  let body = `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(Buffer.from(text, 'utf8'))}\r\n`;
  for (const a of attachments) body += `--${boundary}\r\nContent-Type: ${a.mime}; name="${clean(a.filename).replace(/"/g, '')}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${clean(a.filename).replace(/"/g, '')}"\r\n\r\n${b64lines(a.data)}\r\n`;
  return `${head}\r\n\r\n${body}--${boundary}--\r\n`;
}

/** Minimal SMTP client (STARTTLS on 587 / implicit TLS on 465, AUTH LOGIN). Resolves when the server accepted the message. */
export function sendMail(c: MailConfig, subject: string, text: string, attachments: Attachment[] = [], timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let sock: Socket | TLSSocket = c.secure ? tlsConnect({ host: c.host, port: c.port, servername: c.host }) : createConnection({ host: c.host, port: c.port });
    let buf = '', done = false;
    const waiters: Array<(r: { code: number; text: string }) => void> = [];
    const fail = (e: Error) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); reject(e); };
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), timeoutMs);
    const attach = (s: Socket) => {
      s.setEncoding('utf8');
      s.on('data', (d: string) => {
        buf += d;
        for (;;) { // a reply ends at a line "NNN text" (a "NNN-" line continues it)
          const m = /^(?:\d{3}-.*\r?\n)*(\d{3}) .*\r?\n/.exec(buf);
          if (!m) break;
          const text = buf.slice(0, m[0].length); buf = buf.slice(m[0].length);
          waiters.shift()?.({ code: Number(m[1]), text });
        }
      });
      s.on('error', fail); s.on('close', () => fail(new Error('SMTP connection closed')));
    };
    const reply = () => new Promise<{ code: number; text: string }>(r => waiters.push(r));
    const cmd = async (line: string | null, ok: number[]) => {
      if (line !== null) sock.write(line + '\r\n');
      const r = await reply();
      if (!ok.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.trim().slice(0, 200)}`);
      return r;
    };
    attach(sock);
    (async () => {
      await cmd(null, [220]);
      await cmd('EHLO gridvue.local', [250]);
      if (!c.secure && c.starttls) {
        await cmd('STARTTLS', [220]);
        sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error');
        buf = '';
        sock = tlsConnect({ socket: sock as Socket, servername: c.host });
        attach(sock);
        await new Promise<void>((res, rej) => { (sock as TLSSocket).once('secureConnect', () => res()); sock.once('error', rej); });
        await cmd('EHLO gridvue.local', [250]);
      }
      if (c.user) {
        await cmd('AUTH LOGIN', [334]);
        await cmd(Buffer.from(c.user).toString('base64'), [334]);
        await cmd(Buffer.from(c.pass ?? '').toString('base64'), [235]);
      }
      const addr = (s: string) => `<${clean(s).replace(/[<>]/g, '')}>`;
      await cmd(`MAIL FROM:${addr(c.from.replace(/^.*<(.+)>$/, '$1'))}`, [250]);
      await cmd(`RCPT TO:${addr(c.to)}`, [250, 251]);
      await cmd('DATA', [354]);
      const msg = buildMessage(c, subject, text, attachments).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      sock.write(msg + '.\r\n');
      const r = await reply(); if (r.code !== 250) throw new Error(`SMTP ${r.code}: ${r.text.trim().slice(0, 200)}`);
      sock.write('QUIT\r\n');
      done = true; clearTimeout(timer); sock.destroy(); resolve();
    })().catch(e => fail(e instanceof Error ? e : new Error(String(e))));
  });
}
