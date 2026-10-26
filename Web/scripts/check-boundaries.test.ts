import { describe, expect, it } from 'vitest';
import { checkModuleGraph } from './module-boundaries.ts';

const root = '/project/Web';
function check(files: Record<string, string>) {
  return checkModuleGraph(
    root,
    new Map(
      Object.entries(files).map(([path, code]) => [`${root}/${path}`, code]),
    ),
  );
}

describe('module architecture', () => {
  it('rejects a service importing its React hook', () => {
    expect(
      check({
        'src/modules/math/services/calculate.ts':
          "import { useMath } from '../hooks/use-math.ts';",
        'src/modules/math/hooks/use-math.ts': 'export const useMath = () => 1;',
      }),
    ).toContainEqual(expect.stringContaining('services cannot import hooks'));
  });
});

it('allows a hook to import a service and a service to import another service', () => {
  expect(
    check({
      'src/modules/math/hooks/use-math.ts':
        "import { calculate } from '../services/calculate.ts';",
      'src/modules/math/services/calculate.ts':
        "export { value } from './value.ts';",
      'src/modules/math/services/value.ts': 'export const value = 2;',
    }),
  ).toEqual([]);
});

it('checks dynamic imports and re-exports across module public entries', () => {
  const errors = check({
    'app/example.ts':
      "export { value } from '../src/modules/math/services/value.ts'; import('../src/modules/math/services/value.ts');",
    'src/modules/math/services/value.ts': 'export const value = 2;',
  });
  expect(errors).toContainEqual(
    expect.stringContaining('through a declared public entry'),
  );
});

it('allows public aliases and type-only references without loading server code', () => {
  expect(
    check({
      'src/modules/voice/hooks/use-audio.ts':
        "import type { Value } from '@/modules/problems/server.ts';",
      'src/modules/problems/server.ts':
        "import 'cloudflare:workers'; export type Value = string;",
    }),
  ).toEqual([]);
});

it('rejects server code hidden behind a public barrel in a browser graph', () => {
  expect(
    check({
      'src/modules/workspace/ui/view.tsx':
        "import { value } from '../../problems/index.ts';",
      'src/modules/problems/index.ts':
        "export { value } from './repo/database.ts';",
      'src/modules/problems/repo/database.ts':
        "import { env } from 'cloudflare:workers'; export const value = env;",
    }),
  ).toContainEqual(expect.stringContaining('browser code reaches server code'));
});

it('rejects runtime imports in contracts and local barrel back-edges', () => {
  const errors = check({
    'src/modules/math/types/index.ts':
      "import { limit } from '../config/limits.ts';",
    'src/modules/math/config/limits.ts': 'export const limit = 4;',
    'src/modules/math/services/math.ts': "import { limit } from '../index.ts';",
    'src/modules/math/index.ts': "export { limit } from './config/limits.ts';",
  });
  expect(errors).toContainEqual(
    expect.stringContaining('types must use type-only imports'),
  );
  expect(errors).toContainEqual(
    expect.stringContaining('instead of its public entry'),
  );
});

it('reports unresolved imports and requires layers for new implementation', () => {
  const errors = check({
    'src/modules/math/unclassified.ts': "import './missing.ts';",
  });
  expect(errors).toContainEqual(expect.stringContaining('unresolved'));
  expect(errors).toContainEqual(
    expect.stringContaining('must belong to a declared layer'),
  );
});

it('enforces type-only contracts across modules and external packages', () => {
  const errors = check({
    'src/modules/math/types/index.ts':
      "import { Value } from '../../voice/index.ts'; import { ReactNode } from 'react';",
    'src/modules/voice/index.ts': 'export const Value = 1;',
  });
  expect(errors).toContainEqual(
    expect.stringContaining('types must use type-only imports'),
  );
});

it('requires new modules to declare their public interface', () => {
  expect(
    check({
      'src/modules/future/services/value.ts': 'export const value = 1;',
    }),
  ).toContainEqual(expect.stringContaining('undeclared module future'));
});

it('keeps React out of repositories and direct transport out of services', () => {
  const errors = check({
    'src/modules/math/repo/storage.ts': "import React from 'react';",
    'src/modules/math/services/math.ts':
      "import fs from 'node:fs'; export const load = () => fetch('/api/value');",
  });
  expect(errors).toContainEqual(
    expect.stringContaining('repo cannot load react'),
  );
  expect(errors).toContainEqual(
    expect.stringContaining('services cannot load node:fs'),
  );
  expect(errors).toContainEqual(
    expect.stringContaining('services cannot call global fetch'),
  );
});

it('keeps executable declarations out of the types layer', () => {
  expect(
    check({ 'src/modules/math/types/index.ts': 'export const value = 1;' }),
  ).toContainEqual(expect.stringContaining('types may contain only contracts'));
});

it('allows the isolated workspace presentation entry without opening private UI paths', () => {
  expect(
    check({
      'app/native.tsx':
        "import { EquationCarousel } from '../src/modules/workspace/ui.ts';",
      'src/modules/workspace/ui.ts':
        "export { EquationCarousel } from './ui/equation-carousel.tsx';",
      'src/modules/workspace/ui/equation-carousel.tsx':
        'export const EquationCarousel = () => null;',
    }),
  ).toEqual([]);
});
