import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

export function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((res, rej) => scrypt(pw, salt, 64, (e, key) => (e ? rej(e) : res(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`))));
}
export function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, saltHex, keyHex] = stored.split('$');
  return new Promise((res, rej) => scrypt(pw, Buffer.from(saltHex, 'hex'), 64, (e, key) => (e ? rej(e) : res(timingSafeEqual(key, Buffer.from(keyHex, 'hex'))))));
}
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
