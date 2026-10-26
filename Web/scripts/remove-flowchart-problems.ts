import { neon } from '@neondatabase/serverless';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createProblem,
  decodeProblemLibrary,
  type ProblemLibrary,
} from '../src/modules/problems/index.ts';

/** One-time deletion of problems containing retired flowcharts; no runtime compatibility is installed. */
export function removeFlowchartProblems(original: ProblemLibrary) {
  const book = structuredClone(original);
  const containsFlowchart = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if ('mode' in value && value.mode === 'diagram') return true;
    return Object.values(value).some(containsFlowchart);
  };
  let removed = 0;
  for (const assignment of book.assignments) {
    assignment.problems = assignment.problems.filter((problem) => {
      if (!containsFlowchart(problem)) return true;
      removed++;
      return false;
    });
    if (!assignment.problems.length) assignment.problems.push(createProblem());
  }
  const assignment = book.assignments.find((a) => a.id === book.assignmentId);
  if (!assignment?.problems.some((p) => p.id === book.problemId)) {
    book.assignmentId = book.assignments[0].id;
    book.problemId = book.assignments[0].problems[0].id;
    book.draft = '';
  }
  // Remove the unused field from surviving records, including recovery snapshots.
  const cleaned = JSON.parse(
    JSON.stringify(book, (key, value) =>
      key === 'diagram' ? undefined : value,
    ),
  );
  return { book: decodeProblemLibrary(JSON.stringify(cleaned)), removed };
}

if (import.meta.main) {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
  const configured =
    process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!configured) throw new Error('Database configuration is required.');
  const url = new URL(configured);
  url.hostname = url.hostname.replace('-pooler.', '.');
  const sql = neon(url.toString());
  const rows =
    (await sql`SELECT owner_id,revision,notebook FROM math_audio_notebooks ORDER BY owner_id`) as {
      owner_id: string;
      revision: string;
      notebook: ProblemLibrary;
    }[];
  const changes = rows
    .map((row) => ({ ...row, ...removeFlowchartProblems(row.notebook) }))
    .filter(
      (row) =>
        row.removed ||
        JSON.stringify(row.book) !== JSON.stringify(row.notebook),
    );
  console.log(
    JSON.stringify({
      mode: process.argv.includes('--apply') ? 'apply' : 'preview',
      notebooks: rows.length,
      changedNotebooks: changes.length,
      removedProblems: changes.reduce((n, row) => n + row.removed, 0),
    }),
  );
  if (process.argv.includes('--apply')) {
    const backup = new URL('../.wrangler/flowchart-cleanup/', import.meta.url);
    await mkdir(backup, { recursive: true });
    await writeFile(
      new URL(Date.now() + '.json', backup),
      JSON.stringify(changes),
      { mode: 0o600 },
    );
    await sql.transaction(
      changes.flatMap((row) => [
        sql`WITH changed AS (UPDATE math_audio_notebooks SET notebook=${JSON.stringify(row.book)}::jsonb, clarification=CASE WHEN ${row.removed > 0} THEN NULL ELSE clarification END, revision=revision+1, updated_at=now() WHERE owner_id=${row.owner_id} AND revision=${row.revision} RETURNING owner_id) SELECT 1/count(*)::int AS applied FROM changed`,
        ...(row.removed
          ? [
              sql`DELETE FROM math_audio_requests WHERE owner_id=${row.owner_id}`,
            ]
          : []),
      ]),
    );
    console.log(JSON.stringify({ applied: true }));
  }
}
