import { mergeProblemLibrary } from '../../problems/index.ts';
import { problemLibraryStore } from '../../problems/server.ts';
import { accountDatabase } from './database.ts';

/** Claims a browser guest's work once, preserving an existing account's saved problems. */
export function createGuestTransfer(
  connect: typeof accountDatabase,
  store: typeof problemLibraryStore,
) {
  return async function transferGuest(guest: string, owner: string) {
    const sql = connect();
    for (let attempt = 0; attempt < 3; attempt++) {
      const [source] =
        await sql`SELECT n.notebook, n.revision FROM math_audio_notebooks n JOIN mathwave_guests g ON n.owner_id = g.owner_id WHERE g.owner_id = ${guest}`;
      if (!source) return;
      const target = await store.load(owner);
      const imported = source.notebook as typeof target.book;
      const merged = mergeProblemLibrary(target.book, imported);
      const assignmentIndex = imported.assignments.findIndex(
        (item) => item.id === imported.assignmentId,
      );
      const importedAssignment = imported.assignments[assignmentIndex];
      const selected =
        merged.assignments[target.book.assignments.length + assignmentIndex];
      const problemIndex =
        importedAssignment?.problems.findIndex(
          (item) => item.id === imported.problemId,
        ) ?? -1;
      if (selected && problemIndex >= 0) {
        merged.assignmentId = selected.id;
        merged.problemId = selected.problems[problemIndex].id;
        merged.draft = imported.draft;
      }
      let claimed;
      try {
        [claimed] = await sql.transaction(
          [
            sql`WITH claim AS (
        UPDATE mathwave_guests SET claimed_by = ${owner} WHERE owner_id = ${guest}
          AND EXISTS (SELECT 1 FROM math_audio_notebooks WHERE owner_id = ${owner} AND revision = ${target.revision})
          AND EXISTS (SELECT 1 FROM math_audio_notebooks WHERE owner_id = ${guest} AND revision = ${source.revision}) RETURNING owner_id
      ), moved AS (
        UPDATE math_audio_notebooks SET notebook = ${JSON.stringify(merged)}::jsonb, revision = revision + 1, updated_at = now()
        WHERE owner_id = ${owner} AND revision = ${target.revision} AND EXISTS (SELECT 1 FROM claim) RETURNING owner_id
      ), receipts AS (
        DELETE FROM math_audio_requests WHERE owner_id = ${guest} AND EXISTS (SELECT 1 FROM moved) RETURNING request_id
      ) DELETE FROM math_audio_notebooks WHERE owner_id = ${guest} AND EXISTS (SELECT 1 FROM moved)
        AND (SELECT COUNT(*) FROM receipts) >= 0 RETURNING owner_id`,
          ],
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if ((error as { code?: string }).code === '40001' && attempt < 2)
          continue;
        throw error;
      }
      if (claimed.length) return;
    }
    throw new Error(
      'Your work changed during sign-in. Retry to bring your trial work across.',
    );
  };
}
export const transferGuest = createGuestTransfer(
  accountDatabase,
  problemLibraryStore,
);
