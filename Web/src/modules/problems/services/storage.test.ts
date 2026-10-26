import { test, expect } from 'vitest';
import { createProblemLibrary, saveDraft, STORAGE_KEY } from '../index.ts';
import {
  readProblemLibrary,
  writeProblemLibrary,
  ProblemLibraryStorageConflict,
} from '../index.ts';

function fixture(raw: string | null = null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(STORAGE_KEY, raw);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('saved drafts and the active problem survive a storage round trip', () => {
  const storage = fixture();
  const { book, raw } = readProblemLibrary(storage);
  const edited = saveDraft(book, 'divide both sides by');
  const saved = writeProblemLibrary(storage, edited, raw);
  const restored = readProblemLibrary(storage);
  expect(restored.raw).toBe(saved);
  expect(restored.book.draft).toBe('divide both sides by');
  expect(restored.book.problemId).toBe(edited.problemId);
});

test('a conflicting tab retains its saved work and blocks this write', () => {
  const storage = fixture();
  const original = readProblemLibrary(storage);
  const other = saveDraft(createProblemLibrary(), 'other tab');
  const saved = writeProblemLibrary(storage, other, null);
  expect(() =>
    writeProblemLibrary(storage, original.book, original.raw),
  ).toThrow(ProblemLibraryStorageConflict);
  expect(storage.getItem(STORAGE_KEY)).toBe(saved);
});

test('corrupt saved work stays untouched when it cannot be decoded', () => {
  const storage = fixture('{broken');
  expect(() => readProblemLibrary(storage)).toThrow();
  expect(storage.getItem(STORAGE_KEY)).toBe('{broken');
});

test('a failed storage write propagates without acknowledging a save', () => {
  const storage = fixture();
  storage.setItem = () => {
    throw new Error('quota exceeded');
  };
  expect(() =>
    writeProblemLibrary(storage, createProblemLibrary(), null),
  ).toThrow('quota exceeded');
  expect(storage.getItem(STORAGE_KEY)).toBeNull();
});
