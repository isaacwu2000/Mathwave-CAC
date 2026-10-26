import WebSocket from 'ws';

// Explicit opt-in live provider check. Never records or prints microphone audio.
if (process.env.RUN_LIVE_CHECK !== 'true')
  throw new Error(
    'Set RUN_LIVE_CHECK=true to run this billable provider check.',
  );
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('OPENAI_API_KEY is required.');
// The Node client supports the authorization header required by the provider.
const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', {
  headers: { Authorization: `Bearer ${key}` },
});
let finalized = false;
const timeout = setTimeout(() => {
  ws.close();
  console.error('Session finalization was not confirmed.');
  process.exitCode = 1;
}, 20000);
ws.addEventListener('open', () =>
  ws.send(
    JSON.stringify({
      type: 'session.start',
      event_id: 'lifecycle-check-start',
      session: {
        model: 'gpt-live-1',
        instructions: 'This is a silent session lifecycle check.',
        delegation: { type: 'client' },
        store: false,
        audio: { format: { type: 'audio/pcm', rate: 24000 } },
      },
    }),
  ),
);
ws.addEventListener('message', (event) => {
  if (typeof event.data !== 'string') return;
  const value = JSON.parse(event.data);
  if (value.type === 'session.started') {
    console.log(
      JSON.stringify({ event: value.type, sessionId: value.session?.id }),
    );
    ws.send(
      JSON.stringify({
        type: 'session.close',
        event_id: 'lifecycle-check-close',
      }),
    );
  } else if (value.type === 'session.closed') {
    finalized = true;
    clearTimeout(timeout);
    console.log(
      JSON.stringify({
        event: value.type,
        reason: value.reason,
        usage: value.usage,
      }),
    );
    ws.close();
  } else if (value.type === 'error') {
    console.error(
      JSON.stringify({
        event: value.type,
        code: value.error?.code,
        message: value.error?.message,
      }),
    );
    clearTimeout(timeout);
    process.exitCode = 1;
    ws.close();
  }
});
ws.addEventListener('close', () => {
  clearTimeout(timeout);
  if (!finalized) process.exitCode = 1;
});
ws.addEventListener('error', () => {
  clearTimeout(timeout);
  console.error('Provider WebSocket could not connect.');
  process.exitCode = 1;
});
