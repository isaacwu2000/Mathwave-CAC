import { database } from '../repo/database.ts';
import { createProblemLibraryStore } from '../repo/store.ts';
import { createProblemLibrary } from '../services/problem-library.ts';
export const problemLibraryStore = createProblemLibraryStore(
  database,
  createProblemLibrary,
);
