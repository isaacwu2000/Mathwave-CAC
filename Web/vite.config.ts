import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import {
  createDevInstance,
  devInstancePlugin,
} from './scripts/dev-instance.ts';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: './worker.ts',
  compatibility_flags: ['nodejs_compat'],
  durable_objects: {
    bindings: [{ name: 'VOICE_QUOTA', class_name: 'VoiceQuota' }],
  },
  migrations: [{ tag: 'voice-quota-v1', new_sqlite_classes: ['VoiceQuota'] }],
  triggers: { crons: ['*/5 * * * *'] },
};

export default defineConfig(async ({ command }) => {
  const instance =
    command === 'serve'
      ? createDevInstance(
          process.env.MATH_AUDIO_DEV_PROBLEM ??
            process.env.MATH_AUDIO_DEV_NOTEBOOK,
          process.env.MATH_AUDIO_DEV_INSTANCE_ID,
        )
      : undefined;
  // Keep the same instance through Vite configuration restarts in this process.
  if (instance) process.env.MATH_AUDIO_DEV_INSTANCE_ID = instance.id;
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH = instance
    ? `${instance.directory}/logs`
    : '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH = instance
    ? `${instance.directory}/registry`
    : '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    cacheDir: instance ? `${instance.directory}/vite` : undefined,
    server: {
      strictPort: false,
      open: process.env.MATH_AUDIO_DEV_OPEN === 'true',
      watch: isCodexSeatbeltSandbox
        ? { useFsEvents: false, usePolling: true }
        : undefined,
    },
    plugins: [
      ...(instance ? [devInstancePlugin(instance)] : []),
      vinext(),
      cloudflare({
        persistState: instance ? { path: `${instance.directory}/state` } : true,
        inspectorPort: instance ? false : undefined,
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: {
          ...localBindingConfig,
          ...(command === 'build'
            ? {
                workers_dev: true,
                routes: [
                  { pattern: 'mathwave.app/*', zone_name: 'mathwave.app' },
                ],
              }
            : {}),
          ...(instance
            ? {
                vars: {
                  CLOUD_TEST_PROBLEM_OWNER: instance.problemLibraryOwner,
                  ...(process.env.MATH_AUDIO_COMMAND_PROFILE
                    ? {
                        MATH_AUDIO_COMMAND_PROFILE:
                          process.env.MATH_AUDIO_COMMAND_PROFILE,
                      }
                    : {}),
                },
              }
            : {}),
        },
      }),
    ],
  };
});
