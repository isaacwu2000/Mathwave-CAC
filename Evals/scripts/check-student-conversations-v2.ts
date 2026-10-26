import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { replayStudentConversation, type StudentConversation } from "../src/student-conversations.ts";

const sources = [
  "Evals/inputs/student-conversations-v1/algebra.json",
  "Evals/inputs/student-conversations-v1/graphs.json",
  "Evals/inputs/student-conversations-v1/geometry.json",
  "Evals/inputs/student-conversations-v1/statistics-and-context.json",
  "Evals/inputs/student-conversations-v2/equation-extension.json",
];
const cases: StudentConversation[] = [];
const corpusSha256: Record<string, string> = {};
for (const path of sources) {
  const text = await readFile(path, "utf8");
  corpusSha256[path] = createHash("sha256").update(text).digest("hex");
  cases.push(...JSON.parse(text));
}
const ids = new Set<string>(), families = new Set<string>();
for (const item of cases) {
  if (!item.id || !item.family || !item.category || !item.focus || ids.has(item.id) || families.has(item.family))
    throw new Error(`Missing or duplicate identity: ${item.id}`);
  if (item.turns.length < 2 || item.turns.some(turn => !turn.student.trim() || !Array.isArray(turn.programs)))
    throw new Error(`Incomplete conversation: ${item.id}`);
  if (!item.turns.some(turn => turn.expect?.expression !== undefined || turn.expect?.data !== undefined || turn.expect?.messageIncludes?.length))
    throw new Error(`No independent answer oracle: ${item.id}`);
  ids.add(item.id); families.add(item.family);
}
const results = [];
for (const item of cases) {
  const replay = await replayStudentConversation(item);
  results.push({ id: item.id, category: item.category, turns: item.turns.length, errors: replay.errors });
}
const report = {
  lane: "Authored replies injected into the shared local/web executor; no model inference.",
  corpusSha256, cases: cases.length, families: families.size,
  turns: cases.reduce((sum, item) => sum + item.turns.length, 0),
  categories: Object.fromEntries([...new Set(cases.map(item => item.category))].map(category => [category, cases.filter(item => item.category === category).length])),
  passingReferences: results.filter(row => !row.errors.length).length, results,
  visualReview: "Incomplete; replay does not render or establish visual acceptance.",
};
const output = process.argv[2];
if (output) {
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ ...report, corpusSha256: undefined, results: results.filter(row => row.errors.length) }, null, 2));
if (results.some(row => row.errors.length)) process.exitCode = 1;
