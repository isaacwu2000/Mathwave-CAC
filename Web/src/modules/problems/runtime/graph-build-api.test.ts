import { expect, test } from 'vitest';
import { createGraphBuildApi } from './graph-build-api.ts';
import { createProblemLibrary, currentProblem } from '../index.ts';

test('a build streams valid partial geometry but a later invalid operation never becomes ready or saved', async () => {
  const book = createProblemLibrary();
  const api = createGraphBuildApi({
    owner: async () => 'student',
    load: async () => ({ book, clarification: null, revision: 4 }),
    async *generate() {
      yield { command: 'graph y=x^2' };
      yield { command: 'add graph q' };
    },
  });
  const response = await api(
    new Request('https://math.example/api/graph-build', {
      method: 'POST',
      headers: { origin: 'https://math.example' },
      body: JSON.stringify({ text: 'graph a parabola and q', revision: 4 }),
    }),
  );
  const events = (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(events.map((e) => e.type)).toEqual(['preview', 'failed']);
  expect(events[0].state.expression).toBe('y = x^2');
  expect(currentProblem(book).steps).toHaveLength(0);
});

test('a preview reaches the reader before generation finishes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = createGraphBuildApi({
    owner: async () => 'student',
    load: async () => ({
      book: createProblemLibrary(),
      clarification: null,
      revision: 0,
    }),
    async *generate() {
      yield { command: 'graph y=x' };
      await gate;
      yield { command: 'add graph y=2' };
    },
  });
  const response = await api(
    new Request('https://math.example/api/graph-build', {
      method: 'POST',
      headers: { origin: 'https://math.example' },
      body: JSON.stringify({ text: 'compare a line and two', revision: 0 }),
    }),
  );
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('"type":"preview"');
  release();
  let rest = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    rest += new TextDecoder().decode(next.value);
  }
  expect(rest).toContain('"type":"ready"');
});
