import { readRawProblemLibrary } from '../repo/storage.ts';
import type { ProblemLibraryStorage } from '../types/storage.ts';
import {
  createProblemLibrary,
  decodeProblemLibrary,
} from './problem-library.ts';
export type { ProblemLibraryStorage } from '../types/storage.ts';
export {
  ProblemLibraryStorageConflict,
  writeProblemLibrary,
} from '../repo/storage.ts';

/** Read and validate the saved problem without overwriting unreadable work. */
export function readProblemLibrary(storage: ProblemLibraryStorage) {
  const raw = readRawProblemLibrary(storage);
  return {
    raw,
    book: raw ? decodeProblemLibrary(raw) : createProblemLibrary(),
  };
}
