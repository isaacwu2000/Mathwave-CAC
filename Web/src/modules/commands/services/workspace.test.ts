import { test } from 'vitest';
import assert from 'node:assert/strict';
import { initialWorkspace, partsFor } from '../../workspace/state.ts';
import { runCommand } from '../index.ts';
import { describeData, statistics, parseData } from '../../math/index.ts';
import { curvePoints } from '../../visuals/index.ts';
import { evaluateMath, parseMath } from '../../math/index.ts';
const s = () => structuredClone(initialWorkspace);
test('equation confirmations read naturally and keep correction recovery available', () => {
  const written = runCommand(s(), 'write x+3=5');
  assert.equal(written.message, 'Your equation is now x plus 3 equals 5.');
  const edited = runCommand(written.state, 'replace 3 with 2');
  assert.equal(
    edited.message,
    'Your equation is now x plus 2 equals 5. Say undo to go back.',
  );
});
test('spoken corrections preserve prior state and support polite phrasing', () => {
  const original = s();
  const r = runCommand(original, 'Please replace two x with four x.');
  assert.equal(r.changed, true);
  const parsed = parseMath(r.state.expression);
  assert.equal(parsed.kind, 'equation');
  if (parsed.kind === 'equation')
    assert.equal(evaluateMath(parsed.left, { x: 1 }), 2);
  assert.equal(original.expression, initialWorkspace.expression);
  assert.match(r.message, /undo/);
});
test('editing is strict about unknown language, factorial, and repeated targets', () => {
  assert.throws(() => runCommand(s(), '5!'), /Unsupported/);
  assert.throws(
    () => runCommand(s(), 'replace x with y'),
    /more than one|multiple|matches|ambiguous|occurs/i,
  );
  assert.throws(() => runCommand(s(), 'make that better'));
});
test('numeric expressions calculate and equations produce derivation steps', () => {
  const n = runCommand(s(), '2 + 3 * 4').state;
  assert.match(runCommand(n, 'calculate').message, /14/);
  const r = runCommand(s(), 'solve step by step');
  assert.match(r.message, /x = -3 or x = 1/);
  assert.match(r.message, /discriminant/i);
});
test('data parsing supports words, data set alias, negatives and finite bounded values', () => {
  assert.deepEqual(parseData('four, five, minus two'), [4, 5, -2]);
  assert.deepEqual(
    runCommand(s(), 'please data set 1, 2, 3.').state.data,
    [1, 2, 3],
  );
  assert.throws(() => parseData('1, 1/0'));
  assert.throws(() => parseData('1'));
  assert.throws(() => parseData('1,,3'));
  assert.throws(() => parseData('1,10000000000000'));
});
test('outlier summaries distinguish statistics from causal claims', () => {
  const r = statistics([4, 5, 5, 6, 7, 8, 22]);
  assert.equal(r.median, 6);
  assert.equal(r.mean, 57 / 7);
  assert.deepEqual(r.outliers, [{ v: 22, i: 6 }]);
  assert.match(
    describeData([4, 5, 5, 6, 7, 8, 22]),
    /does not establish a trend or cause/,
  );
  assert.equal(statistics([2, 2]).outliers.length, 0);
});
test('mode switches clear stale navigation and examples reset only on request', () => {
  const r = runCommand({ ...s(), selection: 99 }, 'find outliers');
  assert.equal(r.state.selection, 0);
  assert.equal(r.state.mode, 'statistics');
  const edited = runCommand(s(), '3*x = 9').state;
  assert.equal(
    runCommand(edited, 'statistics').state.expression,
    edited.expression,
  );
  assert.equal(
    runCommand(edited, 'equation example').state.expression,
    initialWorkspace.expression,
  );
});
test('voice commands cover workspace, help, audio, and correction recovery', () => {
  const commands: { [key: string]: string } = {
    undo: 'undo',
    help: 'help',
    'close help': 'close-help',
    'stop audio': 'stop',
    'stop listening': 'listen-stop',
    'turn responses off': 'mute',
    'turn responses on': 'unmute',
    slower: 'slower',
    faster: 'faster',
    'play graph': 'sonify',
    'focus input': 'focus',
  };
  for (const [command, action] of Object.entries(commands))
    assert.equal(runCommand(s(), command).action, action);
  const fresh = runCommand(s(), 'new session');
  assert.equal(fresh.changed, true);
  assert.equal(fresh.state.expression, '0');
});
test('graph sampling and point evaluation preserve equation semantics', () => {
  const points = curvePoints('x^2');
  assert.equal(points.length, 201);
  assert.deepEqual(points[100], { x: 0, y: 0 });
  assert.equal(curvePoints('1/x')[100].y, null);
  assert.match(
    runCommand(s(), 'evaluate at x 1').message,
    /left side is 0, right side is 0/,
  );
  assert.match(runCommand(s(), 'describe graph').message, /not a proof/);
  assert.throws(() => runCommand(s(), 'evaluate at x 1/0'));
});
test('part navigation is bounded and structure descriptions remain available', () => {
  const parts = partsFor(s());
  assert.ok(parts.length > 3);
  assert.match(runCommand(s(), 'read the left side').message, /left side/);
  assert.throws(() => runCommand(s(), 'previous part'));
  assert.throws(() => runCommand(s(), 'read part 999'));
});

test('statistics requests accept natural phrases and inline values', () => {
  assert.match(runCommand(s(), 'What is the median?').message, /Median: 6/);
  const r = runCommand(s(), 'find the median of 8, 2, 4, and 10');
  assert.match(r.message, /Median: 6/);
  assert.deepEqual(r.state.data, [8, 2, 4, 10]);
  assert.equal(r.written, true);
  assert.match(runCommand(s(), 'mode of 1, 1, 2, 2, 3').message, /1, 2/);
  assert.match(runCommand(s(), 'mode of 1, 2, 3').message, /none/);
  assert.match(runCommand(s(), 'range of -2, 4, 8').message, /10/);
  assert.match(runCommand(s(), 'sample variance of 1, 2, 3').message, /: 1\./);
  assert.match(
    runCommand(s(), 'population variance of 1, 2, 3').message,
    /0.666667/,
  );
  assert.throws(
    () => runCommand(s(), 'standard deviation'),
    /sample or population/,
  );
});
test('common voice homophones work without an AI connection', () => {
  assert.deepEqual(
    runCommand(s(), 'show me the out liars').state,
    runCommand(s(), 'find outliers').state,
  );
  assert.match(runCommand(s(), 'find out-liers').message, /Potential outliers/);
});

test('flowcharts are no longer an executable workspace feature', () => {
  for (const command of [
    'diagrams',
    'diagram Start then Process then Finish',
    'flowchart Start then End',
  ])
    assert.throws(() => runCommand(s(), command), /flowchart.*removed/i);
});
