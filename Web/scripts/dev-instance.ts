import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * - Returns independent disk paths and a synthetic problem for each dev process.
 * - A name reopens a problem; an instance ID preserves state through config restarts.
 * - Invalid names or IDs throw before startup. No files are written here.
 * - Names always select synthetic data; they never select student problems.
 */
export function createDevInstance(
  problemLibraryName?: string,
  instanceId?: string,
) {
  if (
    problemLibraryName !== undefined &&
    !/^[a-zA-Z0-9_-]{1,80}$/.test(problemLibraryName)
  ) {
    throw new Error(
      'MATH_AUDIO_DEV_PROBLEM must contain 1–80 letters, numbers, underscores or hyphens.',
    );
  }
  if (instanceId !== undefined && !/^[a-f0-9-]{36}$/.test(instanceId)) {
    throw new Error('Invalid dev instance ID.');
  }
  const id = instanceId ?? randomUUID();
  return {
    id,
    directory: resolve('.wrangler/dev', id),
    problemLibraryOwner:
      problemLibraryName === 'shared'
        ? 'test:shared'
        : `test:dev:${problemLibraryName ?? id}`,
  };
}

/**
 * - Records this instance's actual URL and PID after Vite binds a port.
 * - Creates its directory, writes server.json and prints its location.
 * - Filesystem errors propagate; each instance writes only its own manifest.
 */
export function devInstancePlugin(
  instance: ReturnType<typeof createDevInstance>,
): Plugin {
  return {
    name: 'math-audio:dev-instance',
    resolveId(id) {
      if (id === '/@mathwave/dev-instance.js') return '\0mathwave-dev-instance';
    },
    load(id) {
      if (id !== '\0mathwave-dev-instance') return;
      // A tab surviving a server restart must not mix two instances of React.
      return `
        const boot = ${JSON.stringify(instance.id)};
        async function check() {
          try {
            const response = await fetch('/__mathwave_dev_instance', { cache: 'no-store' });
            if (response.ok && (await response.json()).id !== boot) location.reload();
          } catch { /* The development server may still be restarting. */ }
        }
        check();
        if (import.meta.hot) import.meta.hot.on('vite:ws:connect', check);
      `;
    },
    configureServer(server) {
      server.middlewares.use(
        '/__mathwave_dev_instance',
        (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ id: instance.id }));
        },
      );
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string') return;
        const host =
          typeof server.config.server.host === 'string'
            ? server.config.server.host
            : 'localhost';
        const displayHost =
          host === '0.0.0.0' || host === '::' ? 'localhost' : host;
        const scheme = server.config.server.https ? 'https' : 'http';
        const url =
          server.resolvedUrls?.local[0]?.replace(/\/$/, '') ??
          `${scheme}://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${address.port}`;
        mkdirSync(instance.directory, { recursive: true });
        const manifest = resolve(instance.directory, 'server.json');
        writeFileSync(
          manifest,
          JSON.stringify(
            {
              pid: process.pid,
              url,
              problemLibraryOwner: instance.problemLibraryOwner,
            },
            null,
            2,
          ),
        );
        console.log(
          `\nDev instance: ${url}\nProblems: ${instance.problemLibraryOwner}\nInstance file: ${manifest}\n`,
        );
      });
    },
  };
}
