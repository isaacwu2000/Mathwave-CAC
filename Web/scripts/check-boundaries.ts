import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { checkModuleGraph } from './module-boundaries.ts';

const root = resolve(import.meta.dirname, '..');
const files = new Map<string, string>();
function inspect(directory: string) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (
      ['node_modules', 'dist', '.next', '.vinext', '.wrangler'].includes(
        item.name,
      )
    )
      continue;
    const file = resolve(directory, item.name);
    if (item.isDirectory()) inspect(file);
    else if (['.ts', '.tsx'].includes(extname(file)))
      files.set(file, readFileSync(file, 'utf8'));
  }
}
for (const folder of ['src', 'app', '../Evals', '../Native/Engine', 'scripts'])
  inspect(resolve(root, folder));
const errors = checkModuleGraph(root, files);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(`Module architecture checked across ${files.size} source files.`);
