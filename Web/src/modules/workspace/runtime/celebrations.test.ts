import { expect, test } from 'vitest';
import { claimCelebration } from './celebrations.ts';

test('the saved receipt prevents reload, retry and repeated-checker celebrations', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  expect(claimCelebration(storage, 'algebra-1', 1)).toBe(true);
  expect(claimCelebration(storage, 'algebra-1', 1)).toBe(false);
  expect(claimCelebration({ ...storage }, 'algebra-1', 1)).toBe(false);
  expect(claimCelebration(storage, 'algebra-2', 1)).toBe(true);
  expect(claimCelebration(storage, 'algebra-1', 2)).toBe(true);
});

test('blocked storage never breaks the worksheet or launches repeat-prone confetti', () => {
  const storage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {},
  };
  expect(claimCelebration(storage, 'one', 1)).toBe(false);
});
