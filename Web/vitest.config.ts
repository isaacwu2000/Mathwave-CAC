import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Deterministic tests do not need the Cloudflare worker or RSC build plugins.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^vitest$/,
        replacement: fileURLToPath(
          new URL('./node_modules/vitest/dist/index.js', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      '../Evals/**/*.test.ts',
      // Frozen experiment source copies are evidence, not runnable test suites.
      '../Training/LLM/scripts/**/*.test.ts',
      '../Native/Presentation/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
    ],
    restoreMocks: true,
  },
});
