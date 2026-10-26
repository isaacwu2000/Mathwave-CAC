import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  replayStudentConversation,
  type StudentConversation,
} from "../src/student-conversations.ts";

const directory = fileURLToPath(new URL("../inputs/student-conversations-v1", import.meta.url));
const sources = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
const cases: StudentConversation[] = [];
const hashes: Record<string, string> = {};
for (const name of sources) {
  const text = await readFile(resolve(directory, name), "utf8");
  hashes[name] = createHash("sha256").update(text).digest("hex");
  cases.push(...JSON.parse(text));
}
const ids = new Set<string>(),
  families = new Set<string>();
for (const item of cases) {
  if (
    !item.id ||
    !item.family ||
    !item.focus ||
    !item.category ||
    ids.has(item.id) ||
    families.has(item.family)
  )
    throw new Error(`Missing or duplicate scenario identity: ${item.id}`);
  if (
    item.turns.length < 2 ||
    item.turns.some((turn) => !turn.student.trim() || !Array.isArray(turn.programs))
  )
    throw new Error(`Incomplete conversation: ${item.id}`);
  if (
    !item.turns.some(
      (turn) =>
        turn.expect?.expression !== undefined ||
        turn.expect?.data !== undefined ||
        turn.expect?.messageIncludes?.length,
    )
  )
    throw new Error(`No independent answer oracle: ${item.id}`);
  ids.add(item.id);
  families.add(item.family);
}
const results = [];
for (const item of cases) {
  const result = await replayStudentConversation(item);
  results.push({ id: item.id, turns: item.turns.length, errors: result.errors });
}
const report = {
  lane: "Authored reference answers injected into the local/web executor. No model inference.",
  createdAt: new Date().toISOString(),
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpusSha256: hashes,
  cases: cases.length,
  families: families.size,
  turns: cases.reduce((sum, item) => sum + item.turns.length, 0),
  categories: Object.fromEntries(
    [...new Set(cases.map((item) => item.category))].map((category) => [
      category,
      cases.filter((item) => item.category === category).length,
    ]),
  ),
  passingReferences: results.filter((result) => !result.errors.length).length,
  results,
  modelAccuracy: "Not measured. Authored answers were supplied, not predicted.",
  visualReview: "Incomplete. This reference check does not establish full-suite visual acceptance.",
  studentUsability: "Not measured. These are synthetic author-created student utterances.",
  split: "Unassigned. No training updates or train/test split performed.",
};
const output = process.argv[2];
if (output) {
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(
  JSON.stringify(
    {
      cases: report.cases,
      families: report.families,
      turns: report.turns,
      passingReferences: report.passingReferences,
      failures: results.filter((result) => result.errors.length),
      visualReview: report.visualReview,
    },
    null,
    2,
  ),
);
if (results.some((result) => result.errors.length)) process.exitCode = 1;
