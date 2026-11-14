import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMessage, sendMail } from '../src/mailer';
import { createApp, defaultConfig } from '../src/app';
import { openDb } from '../src/db';

/** A tiny SMTP sink that records what it was sent. */
function smtpSink() {
  const got: string[] = [];
  const srv: Server = createServer(sock => {
    let data = false, buf = '';
    sock.on('error', () => {}); sock.write('220 sink\r\n');
    sock.on('data', d => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0 || (data && buf.includes('\r\n.\r\n'))) {
        if (data) { const e = buf.indexOf('\r\n.\r\n'); if (e < 0) break; got.push(buf.slice(0, e)); buf = buf.slice(e + 5); data = false; sock.write('250 queued\r\n'); continue; }
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^EHLO/.test(line)) sock.write('250 sink\r\n'); else if (/^DATA/.test(line)) { data = true; sock.write('354 go\r\n'); } else if (/^QUIT/.test(line)) sock.end('221 bye\r\n'); else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise<{ port: number; got: string[]; close: () => void }>(res => srv.listen(0, '127.0.0.1', () => res({ port: (srv.address() as any).port, got, close: () => srv.close() })));
}

describe('feedback email', () => {
  it('builds a MIME message with attachments and no header injection', () => {
    const m = buildMessage({ from: 'a@b.c', to: 'x@y.z' }, 'Hi\r\nBcc: evil@e.com', 'body', [{ filename: 's.png', mime: 'image/png', data: Buffer.from([1, 2, 3]) }]);
    expect(m).toContain('multipart/mixed');
    expect(m).toContain('filename="s.png"');
    expect(m.split('\r\n\r\n')[0]).not.toMatch(/^Bcc:/m);
  });

  describe('endpoint', () => {
    let sink: Awaited<ReturnType<typeof smtpSink>>, base = '', server: ReturnType<typeof createApp>, cookie = '';
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
    beforeAll(async () => {
      sink = await smtpSink();
      Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_STARTTLS: '0', SMTP_FROM: 'app@example.com' });
      server = createApp(openDb(':memory:'), { ...defaultConfig(), trustedOrigins: [] });
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as any).port}`;
      const r = await fetch(`${base}/api/auth/enter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tess' }) });
      cookie = r.headers.get('set-cookie')!.split(';')[0];
    });
    afterAll(() => { server.close(); sink.close(); for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_STARTTLS', 'SMTP_FROM']) delete process.env[k]; });
    const post = (body: unknown) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });

    it('rejects anonymous, empty and non-image submissions', async () => {
      expect((await fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
      expect((await post({ name: 'Tess', message: '  ' })).status).toBe(400);
      expect((await post({ name: 'Tess', message: 'hi', screenshots: [{ base64: Buffer.from('<svg/>').toString('base64') }] })).status).toBe(400);
    });
    it('emails the report to the product owner with the screenshot attached', async () => {
      const r = await post({ name: 'Tess Tester', kind: 'bug', message: 'The export button does nothing', page: '#/file/abc', screenshots: [{ base64: png }] });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, emailed: true });
      const raw = sink.got.at(-1)!;
      expect(raw).toContain('To: akhilkumar.uxuidesigner@outlook.com');
      expect(raw).toContain('multipart/mixed');
      expect(raw).toContain('screenshot-1.png');
      const text = Buffer.from(raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString();
      expect(text).toContain('The export button does nothing');
      expect(text).toContain('Tess Tester');
      expect(text).toContain('#/file/abc');
    });
  });
});
