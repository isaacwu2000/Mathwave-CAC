import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const configured = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!configured)
  throw new Error(
    'Set DATABASE_URL or DIRECT_DATABASE_URL in the server environment.',
  );
const url = new URL(configured);
url.hostname = url.hostname.replace('-pooler.', '.');
const sql = neon(url.toString());
for (const name of [
  '001-cloud.sql',
  '002-voice-negotiation.sql',
  '003-accounts.sql',
]) {
  const source = readFileSync(
    new URL(
      `../src/modules/${name === '003-accounts.sql' ? 'accounts' : 'problems'}/migrations/${name}`,
      import.meta.url,
    ),
    'utf8',
  );
  const statements = source
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  await sql.transaction(statements.map((statement) => sql.query(statement)));
  console.log(`Applied ${name}`);
}
