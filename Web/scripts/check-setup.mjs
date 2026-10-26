const pnpmVersion = process.env.npm_config_user_agent?.match(/\bpnpm\/([^\s]+)/)?.[1];
console.log(`pnpm ${pnpmVersion ?? 'not detected; use pnpm run check:setup'}`);
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 13);
console.log(
  `Node ${process.versions.node}: ${supported ? 'supported' : 'upgrade to 22.13 or later'}`,
);
const envFile = new URL('.env', root);
let configured = Boolean(process.env.OPENAI_API_KEY?.trim());
if (existsSync(envFile)) {
  // Inspect only whether a value exists; never print the line or key.
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((line) => /^\s*(?:export\s+)?OPENAI_API_KEY\s*=/.test(line));
  const value = line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  configured ||= Boolean(
    value && !value.startsWith('#') && !/^(?:your[_-]|replace|<)/i.test(value),
  );
}
console.log(
  `OpenAI key: ${configured ? 'configured locally (credits and model access not checked)' : 'missing; copy .env.example to .env and add your key'}`,
);
const source = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const databaseConfigured = Boolean(
  process.env.DATABASE_URL || /^DATABASE_URL=.+/m.test(source),
);
console.log(
  `Neon database: ${databaseConfigured ? 'configured locally (connection not checked)' : 'missing; set DATABASE_URL and apply cloud migrations'}`,
);
console.log(
  'Work saves in Neon; configure accounts using Web/.env.example. CLOUD_TEST_MODE=true is loopback-only evaluation access.',
);
console.log(
  'AI endpoints use a server secret and require same-origin requests.',
);
if (!supported) process.exitCode = 1;
