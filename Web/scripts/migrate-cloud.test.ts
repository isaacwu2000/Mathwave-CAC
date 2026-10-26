import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the migration command loads local database configuration alongside the base environment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'math-audio-migration-env-'));
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        scripts: { migrate: manifest.scripts['migrate:cloud'] },
      }),
    );
    writeFileSync(join(directory, '.env'), 'BASE_SETTING=present\n');
    writeFileSync(
      join(directory, '.env.local'),
      'DATABASE_URL=synthetic-local-connection\n',
    );
    mkdirSync(join(directory, 'scripts'));
    // Observe the command's environment without contacting a database or printing credentials.
    writeFileSync(
      join(directory, 'scripts/migrate-cloud.ts'),
      "console.log(JSON.stringify({ base: process.env.BASE_SETTING === 'present', database: process.env.DATABASE_URL === 'synthetic-local-connection' }));",
    );
    const output = execFileSync('pnpm', ['--silent', 'run', 'migrate'], {
      cwd: directory,
      env: { PATH: process.env.PATH, NODE_ENV: 'development' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(JSON.parse(output)).toEqual({ base: true, database: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
