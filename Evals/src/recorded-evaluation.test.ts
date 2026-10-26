import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateRecording, type Recording } from './recorded-evaluation.ts';
const clips: Recording[] = JSON.parse(
  readFileSync('public/demo-voices/manifest.json', 'utf8'),
);
const geometry: Recording[] = JSON.parse(
  readFileSync('public/demo-voices/graph-geometry/manifest.json', 'utf8'),
);
test('a direct recording result checks actual heard numbers, not the fixture text', () => {
  const clip = clips.find((c) => c.case === 'equation')!;
  assert.equal(
    evaluateRecording(clip, 'write two x plus three equals eleven').passed,
    true,
  );
  assert.equal(
    evaluateRecording(clip, 'write two x plus three equals twelve').passed,
    false,
  );
  assert.equal(
    evaluateRecording(clip, 'unrelated background speech').passed,
    false,
  );
});
test('recording checks isolate scenario setup and evaluate graph, geometry, and statistics results', () => {
  for (const id of ['step', 'median', 'outliers']) {
    const clip = clips.find((c) => c.case === id)!;
    assert.equal(evaluateRecording(clip, clip.transcript).passed, true, id);
  }
  for (const id of ['intercepts', 'hypotenuse', 'dimension-edit', 'volume']) {
    const clip = geometry.find((c) => c.case === id)!;
    assert.equal(evaluateRecording(clip, clip.transcript).passed, true, id);
  }
});
test('expected clarification is distinguished from an incorrect geometry action', () => {
  const clip = geometry.find((c) => c.case === 'missing-height')!;
  const actual = evaluateRecording(clip, 'create a rectangle with width six');
  assert.equal(actual.passed, true);
  assert.equal(actual.status, 'clarification');
  assert.equal(
    evaluateRecording(clip, 'create a rectangle with width six and height four')
      .passed,
    false,
  );
});
