import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioPanel } from './audio-panel.tsx';
const props = {
  active: false,
  starting: false,
  speaking: false,
  partial: 'close help',
  reply: 'The answer is four.',
  status: 'monitoring',
  waveform: [0],
  onToggle() {},
};

test('recording off leaves the microphone transcript blank despite stale input', () => {
  const html = renderToStaticMarkup(<AudioPanel {...props} />);
  const microphone = html.slice(
    html.indexOf('<button'),
    html.indexOf('</button>'),
  );
  expect(microphone).not.toContain('close help');
  expect(microphone).not.toContain('Click to speak');
  expect(microphone).not.toContain('The answer is four.');
});

test('student transcription stays in the microphone and AI text follows Pico', () => {
  const html = renderToStaticMarkup(<AudioPanel {...props} active speaking />);
  const microphone = html.slice(
    html.indexOf('<button'),
    html.indexOf('</button>'),
  );
  expect(microphone).toContain('close help');
  expect(microphone).not.toContain('The answer is four.');
  expect(html).toContain('class="pico-reply"');
  expect(html.indexOf('aria-label="Pico')).toBeLessThan(
    html.indexOf('The answer is four.'),
  );
});

test('request progress stays beneath the AI reply as an italic live status', () => {
  const html = renderToStaticMarkup(
    <AudioPanel {...props} progress={<em>Graphing…</em>} />,
  );
  expect(html.indexOf('The answer is four.')).toBeLessThan(
    html.indexOf('<em>Graphing…</em>'),
  );
  expect(html).toContain('<output');
  expect(html).not.toContain('graph-build-status');
});

test('Pico can listen, work, and speak together without conflating request progress with audio', () => {
  const html = renderToStaticMarkup(
    <AudioPanel {...props} active working speaking />,
  );
  expect(html).toContain('aria-label="Pico: listening, working, speaking"');
  const quiet = renderToStaticMarkup(<AudioPanel {...props} active working />);
  expect(quiet).toContain('aria-label="Pico: listening, working"');
  expect(quiet).not.toContain('data-speaking="true"');
});

test('Pico keeps a still clarification or recovery expression without pretending to speak', () => {
  expect(
    renderToStaticMarkup(<AudioPanel {...props} attention="clarifying" />),
  ).toContain('aria-label="Pico: waiting for clarification"');
  const failed = renderToStaticMarkup(
    <AudioPanel {...props} attention="unavailable" />,
  );
  expect(failed).toContain('aria-label="Pico: ready to retry"');
  expect(failed).not.toContain('data-speaking="true"');
});
