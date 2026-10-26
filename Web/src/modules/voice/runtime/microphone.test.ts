import { test } from 'vitest';
import assert from 'node:assert/strict';
import { checkMicrophone } from '../index.ts';

test('capture preflight releases every track and classifies device failures', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  let secure = true,
    stopped = 0,
    failure: string | undefined;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      get isSecureContext() {
        return secure;
      },
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints: unknown) {
          assert.deepEqual(constraints, { audio: true });
          if (failure) throw new DOMException('device failure', failure);
          return {
            getTracks: () => [
              { stop: () => stopped++ },
              { stop: () => stopped++ },
            ],
          };
        },
      },
    },
  });
  try {
    const release = await checkMicrophone();
    assert.equal(stopped, 0);
    release();
    assert.equal(stopped, 2);
    for (const [name, expected] of [
      ['NotAllowedError', /denied/],
      ['NotFoundError', /No microphone/],
      ['NotReadableError', /busy/],
      ['AbortError', /could not be opened/],
    ] as const) {
      failure = name;
      await assert.rejects(checkMicrophone(), expected);
    }
    secure = false;
    await assert.rejects(checkMicrophone(), /HTTPS or localhost/);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousNavigator)
      Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
