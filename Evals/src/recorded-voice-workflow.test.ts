import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VoiceSession,
  type Recognition,
} from '../../Web/src/modules/voice/index.ts';
import { runCommand } from '../../Web/src/modules/commands/index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  contentChanged,
  updateProblem,
} from '../../Web/src/modules/problems/index.ts';
import { ClarificationError } from '../../Web/src/modules/math/index.ts';
import {
  resolveClarification,
  type ClarificationContext,
} from '../../Web/src/modules/commands/index.ts';
const raw = JSON.parse(
  readFileSync(
    '../Evals/inputs/recorded-graph-geometry/transcripts-full-replies.json',
    'utf8',
  ),
).clips as Array<{ voice: string; case: string; transcript: string }>;
function clip(voice: string, id: string) {
  const c = raw.find((r) => r.voice === voice && r.case === id);
  assert.ok(c);
  return c.transcript;
}
function harness() {
  let book = createProblemLibrary(),
    pending: ClarificationContext | undefined,
    message = '',
    deliveries = 0;
  const recognition: Recognition = {
    lang: '',
    continuous: false,
    interimResults: false,
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      this.onstart?.();
    },
    abort() {},
  };
  const session = new VoiceSession(() => recognition, {
    state() {},
    partial() {},
    error(m) {
      throw new Error(m);
    },
    command(text) {
      deliveries++;
      const command = resolveClarification(pending, text) ?? text;
      try {
        const before = currentProblem(book).state,
          result = runCommand(before, command);
        if (result.written || contentChanged(before, result.state))
          book = recordStep(
            book,
            result.state,
            result.storedCommand ?? command,
          );
        else if (result.changed)
          book = updateProblem(book, (p) => ({ ...p, state: result.state }));
        pending = undefined;
        message = result.message;
      } catch (error) {
        if (!(error instanceof ClarificationError)) throw error;
        pending = { request: command, question: error.message };
        message = error.message;
      }
    },
  });
  session.toggle();
  const results: Array<{ isFinal: boolean; 0: { transcript: string } }> = [];
  return {
    send(text: string) {
      results.push({ isFinal: true, 0: { transcript: text } });
      const event = { resultIndex: results.length - 1, results };
      recognition.onresult?.(event);
      recognition.onresult?.(event);
    },
    get book() {
      return book;
    },
    get pending() {
      return pending;
    },
    get message() {
      return message;
    },
    get deliveries() {
      return deliveries;
    },
    stop() {
      session.stop();
    },
  };
}
test('actual recorded transcripts traverse voice delivery once and preserve graph query history', () => {
  const h = harness();
  try {
    for (const id of ['function', 'range', 'intercepts', 'point'])
      h.send(clip('Daniel', id));
    assert.equal(h.deliveries, 4);
    assert.equal(currentProblem(h.book).steps.length, 1);
    assert.deepEqual(currentProblem(h.book).state.graphRange, {
      min: -5,
      max: 5,
    });
    assert.match(h.message, /y = 5/);
  } finally {
    h.stop();
  }
});
test('a recorded misheard number requires clarification and a recorded sentence repairs only that dimension', () => {
  const h = harness();
  try {
    h.send(clip('Karen', 'rectangle'));
    h.send(clip('Karen', 'dimension-edit'));
    assert.ok(h.pending);
    assert.equal(currentProblem(h.book).steps.length, 1);
    assert.equal(currentProblem(h.book).state.geometry!.dimensions.width, 6);
    h.send(clip('Rishi', 'width-clear-reply'));
    assert.equal(h.pending, undefined);
    assert.deepEqual(currentProblem(h.book).state.geometry!.dimensions, {
      width: 8,
      height: 4,
    });
    assert.equal(currentProblem(h.book).steps.length, 2);
    assert.equal(h.deliveries, 3);
  } finally {
    h.stop();
  }
});
test('failed short recordings retain the original geometry question until a clear recorded reply', () => {
  const h = harness();
  try {
    h.send(clip('Daniel', 'missing-height'));
    h.send(clip('Karen', 'height-reply'));
    h.send(clip('Daniel', 'height-confirm'));
    assert.ok(h.pending);
    assert.equal(currentProblem(h.book).steps.length, 0);
    h.send(clip('Daniel', 'height-clear-reply'));
    assert.equal(h.pending, undefined);
    assert.deepEqual(currentProblem(h.book).state.geometry!.dimensions, {
      width: 6,
      height: 4,
    });
    assert.equal(currentProblem(h.book).steps.length, 1);
  } finally {
    h.stop();
  }
});
