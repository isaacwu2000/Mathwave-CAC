import { expect, test } from 'vitest';
import { scopedStorage } from './scoped-storage.ts';

test('switching accounts cannot recover another student’s pending save', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const first = scopedStorage(storage, 'user:first');
  const second = scopedStorage(storage, 'user:second');
  first.setItem('pending-save', 'private draft');
  expect(second.getItem('pending-save')).toBeNull();
  second.removeItem('pending-save');
  expect(first.getItem('pending-save')).toBe('private draft');
});
