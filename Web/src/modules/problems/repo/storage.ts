import type { ProblemLibrary } from '../types/problem-library.ts';
import { STORAGE_KEY } from '../config/storage.ts';
import type { ProblemLibraryStorage } from '../types/storage.ts';
export class ProblemLibraryStorageConflict extends Error {}

/** Reads the existing serialized problem without changing it. */
export function readRawProblemLibrary(
  storage: ProblemLibraryStorage,
): string | null {
  return storage.getItem(STORAGE_KEY);
}

/** Writes only when the stored revision still matches the caller's read. */
export function writeProblemLibrary(
  storage: ProblemLibraryStorage,
  book: ProblemLibrary,
  expectedRaw: string | null,
): string {
  if (storage.getItem(STORAGE_KEY) !== expectedRaw)
    throw new ProblemLibraryStorageConflict(
      'Another tab changed this problem.',
    );
  const raw = JSON.stringify(book);
  storage.setItem(STORAGE_KEY, raw);
  return raw;
}
