import { neon } from '@neondatabase/serverless';
import { env } from 'cloudflare:workers';

export function accountDatabase() {
  const url = (env as unknown as { DATABASE_URL?: string }).DATABASE_URL;
  if (!url) throw new Error('Account database is not configured.');
  return neon(url);
}
