import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt-v1$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, key] = stored.split('$');
  if (algorithm !== 'scrypt-v1' || !salt || !key || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(key)) return false;
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex')), Buffer.from(key, 'hex'));
}
export const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
export function sameSecret(received: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(digest(received), 'hex'), Buffer.from(digest(expected), 'hex'));
}
