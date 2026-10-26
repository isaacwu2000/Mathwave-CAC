import { expect, test } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'vite';
import { createDevInstance, devInstancePlugin } from './dev-instance.ts';

test('concurrent dev runs have independent caches, worker state and problems', () => {
  const first = createDevInstance();
  const second = createDevInstance();
  expect(first.directory).not.toBe(second.directory);
  expect(first.problemLibraryOwner).not.toBe(second.problemLibraryOwner);
  expect(first.problemLibraryOwner).toMatch(/^test:dev:/);
});

test('named dev problems can be reopened without sharing disk state', () => {
  const first = createDevInstance('isaac');
  const second = createDevInstance('isaac');
  expect(first.problemLibraryOwner).toBe('test:dev:isaac');
  expect(second.problemLibraryOwner).toBe(first.problemLibraryOwner);
  expect(second.directory).not.toBe(first.directory);
  expect(() => createDevInstance('../student')).toThrow(
    'MATH_AUDIO_DEV_PROBLEM',
  );
});

test('a configuration restart keeps the running instance problem and disk state', () => {
  const first = createDevInstance();
  const restarted = createDevInstance(undefined, first.id);
  expect(restarted).toEqual(first);
});

test('the shared name reopens the existing development problem', () => {
  expect(createDevInstance('shared').problemLibraryOwner).toBe('test:shared');
});

test('an occupied port selects a new URL and records the actual listening port', async () => {
  const firstInstance = createDevInstance();
  const first = await createServer({
    configFile: false,
    cacheDir: `${firstInstance.directory}/vite`,
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0 },
  });
  const instance = createDevInstance();
  let second: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await first.listen();
    const address = first.httpServer!.address() as { port: number };
    second = await createServer({
      configFile: false,
      cacheDir: `${instance.directory}/vite`,
      optimizeDeps: { noDiscovery: true },
      server: { host: '127.0.0.1', port: address.port, strictPort: false },
      plugins: [devInstancePlugin(instance)],
    });
    await second.listen();
    const actual = second.httpServer!.address() as { port: number };
    expect(actual.port).not.toBe(address.port);
    const identity = await fetch(
      `http://127.0.0.1:${actual.port}/__mathwave_dev_instance`,
    );
    expect(identity.headers.get('cache-control')).toBe('no-store');
    expect(await identity.json()).toEqual({ id: instance.id });
    const guard = await second.transformRequest('/@mathwave/dev-instance.js');
    expect(guard?.code).toContain(instance.id);
    const servedGuard = await fetch(
      `http://127.0.0.1:${actual.port}/@mathwave/dev-instance.js`,
    );
    expect(servedGuard.ok).toBe(true);
    expect(await servedGuard.text()).toContain(instance.id);
    expect(guard?.code).toContain('vite:ws:connect');
    const manifest = JSON.parse(
      readFileSync(`${instance.directory}/server.json`, 'utf8'),
    );
    expect(manifest.url).toBe(`http://127.0.0.1:${actual.port}`);
    expect(manifest.problemLibraryOwner).toBe(instance.problemLibraryOwner);
  } finally {
    await second?.close();
    await first.close();
    rmSync(instance.directory, { recursive: true, force: true });
    rmSync(firstInstance.directory, { recursive: true, force: true });
  }
});
