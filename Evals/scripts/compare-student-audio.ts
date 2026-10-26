import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, access, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Buffer } from "node:buffer";
const execute = promisify(execFile);
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
import type { StudentConversation } from "../src/student-conversations.ts";

// A small recorded-input sample; this never launches a full agent or updates weights.
const root = fileURLToPath(new URL("../..", import.meta.url));
const directory = resolve(root, "Evals/inputs/student-conversations-v1");
const output = resolve(root, "Evals/evaluations/student-conversations-v1-2026-10-22/audio");
const selected = [
  "alg-solve-sides-reversed",
  "student-sign-correction-data",
  "geo-corresponding-angle-marks",
  "graph-viewport-then-translation",
];
const models = ["google/gemini-2.5-flash-lite", "qwen/qwen3.8-omni-flash"];
const paid = process.argv.includes("--run");
const key = process.env.OPENROUTER_API_KEY;
if (paid && !key) throw new Error("OPENROUTER_API_KEY is missing. No paid requests sent.");
await mkdir(output, { recursive: true });
const ledgerPath = resolve(output, "ledger.json");
if (await exists(ledgerPath))
  throw new Error(
    "This campaign already has a ledger. Inspect it; never automatically repeat paid requests.",
  );
const catalog = (await (await fetch("https://openrouter.ai/api/v1/models")).json()) as {
  data: {
    id: string;
    context_length: number;
    pricing: Record<string, string>;
    architecture: { input_modalities: string[] };
  }[];
};
const pricing = models.map((id) => {
  const entry = catalog.data.find((item) => item.id === id);
  if (!entry?.architecture.input_modalities.includes("audio"))
    throw new Error(`Audio model unavailable: ${id}`);
  const rate = Math.max(
    Number(entry.pricing.prompt),
    Number(entry.pricing.audio ?? entry.pricing.prompt),
  );
  const worstCase = entry.context_length * rate + 256 * Number(entry.pricing.completion);
  if (!Number.isFinite(worstCase) || rate < 0 || worstCase > 2)
    throw new Error(`Unbounded request price: ${id}`);
  return { id, pricing: entry.pricing, contextLength: entry.context_length, reservationUsd: 2 };
});
const cases: StudentConversation[] = [];
for (const file of (await readdir(directory)).filter((name) => name.endsWith(".json")))
  cases.push(...JSON.parse(await readFile(resolve(directory, file), "utf8")));
const manifestPath = resolve(output, "manifest.json");
const previous = (await exists(manifestPath))
  ? (JSON.parse(await readFile(manifestPath, "utf8")) as {
      case: string;
      turn: number;
      reference: string;
      voice: string;
      sha256: string;
    }[])
  : [];
const clips = [];
for (const [caseIndex, id] of selected.entries()) {
  const scenario = cases.find((item) => item.id === id);
  if (!scenario) throw new Error(`Missing case ${id}`);
  for (const [index, turn] of scenario.turns.entries()) {
    const stem = `${id}-${index + 1}`;
    const voice = caseIndex % 2 ? "Daniel" : "Samantha";
    const textPath = resolve(output, `${stem}.txt`);
    const aiff = resolve(output, `${stem}.aiff`);
    const wav = resolve(output, `${stem}.wav`);
    if (await exists(wav)) {
      const frozen = previous.find((item) => item.case === id && item.turn === index + 1);
      const hash = createHash("sha256")
        .update(await readFile(wav))
        .digest("hex");
      if (
        !frozen ||
        frozen.reference !== turn.student ||
        frozen.voice !== voice ||
        frozen.sha256 !== hash
      )
        throw new Error(`Stale or unverified audio: ${stem}`);
    } else {
      await writeFile(textPath, turn.student);
      for (const command of [
        ["say", "-v", voice, "-f", textPath, "-o", aiff],
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav],
      ]) {
        await execute(command[0], command.slice(1));
      }
      await unlink(aiff);
      await unlink(textPath);
    }
    const bytes = await readFile(wav);
    if (bytes.length > 3_000_000) throw new Error("Clip exceeds the bounded audio request size.");
    clips.push({
      case: id,
      turn: index + 1,
      reference: turn.student,
      voice,
      source: "macOS say synthetic speech; not a student recording",
      audio: wav.slice(root.length + 1),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
await writeFile(resolve(output, "manifest.json"), JSON.stringify(clips, null, 2) + "\n");
if (!paid) {
  console.log(
    `Prepared ${clips.length} clips. No paid calls. Use --run explicitly to compare audio models.`,
  );
  process.exit(0);
}
const ledger = {
  capUsd: 8,
  scope: "Only this new student-conversation audio campaign",
  models: pricing,
  spentUsd: 0,
  reservedUnknownUsd: 0,
  records: [] as object[],
  visualReview: "Incomplete; audio transcription only, no in-app result acceptance.",
  modelAccuracy:
    "Recorded-input transcription sample; not streaming, human speech or an agent benchmark.",
};
const persist = () => writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
const prompt =
  "Transcribe the English speech verbatim. Return only the transcript. Keep all numbers, signs, corrections and references. Do not answer the math question.";
for (const clip of clips) {
  for (const model of pricing) {
    // Reserve the price bound before the request; unknown or interrupted charges stay reserved.
    if (ledger.spentUsd + ledger.reservedUnknownUsd + model.reservationUsd > ledger.capUsd)
      throw new Error("Budget reservation would exceed $8.");
    ledger.reservedUnknownUsd += model.reservationUsd;
    const record: Record<string, unknown> = {
      case: clip.case,
      turn: clip.turn,
      model: model.id,
      audio: clip.audio,
      sha256: clip.sha256,
      reference: clip.reference,
      prompt,
      maxTokens: 256,
      status: "pending",
      reservationUsd: model.reservationUsd,
    };
    ledger.records.push(record);
    await persist();
    const started = performance.now();
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          max_tokens: 256,
          temperature: 0,
          provider: { allow_fallbacks: false },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "input_audio",
                  input_audio: {
                    data: Buffer.from(await readFile(resolve(root, clip.audio))).toString("base64"),
                    format: "wav",
                  },
                },
              ],
            },
          ],
        }),
      });
      const body = (await response.json()) as {
        id?: string;
        error?: unknown;
        usage?: { cost?: number };
        choices?: { message: { content: unknown } }[];
      };
      record.elapsedMs = performance.now() - started;
      record.httpStatus = response.status;
      record.generationId = body.id;
      record.usage = body.usage;
      record.transcript = body.choices?.[0]?.message.content;
      record.error = body.error;
      const cost = body.usage?.cost;
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        record.status = "charge-unknown";
        await persist();
        throw new Error("Provider did not report cost. Stopped without paid retries.");
      }
      ledger.spentUsd += cost;
      ledger.reservedUnknownUsd -= model.reservationUsd;
      record.costUsd = cost;
      record.status = response.ok ? "complete" : "failed";
      await persist();
      if (!response.ok || cost > model.reservationUsd)
        throw new Error("Provider error or unexpected price. Stopped without retries.");
    } catch (error) {
      if (record.status === "pending") record.status = "charge-unknown";
      record.failure = error instanceof Error ? error.message : String(error);
      await persist();
      throw error;
    }
  }
}
console.log(
  JSON.stringify({
    clips: clips.length,
    requests: ledger.records.length,
    spentUsd: ledger.spentUsd,
    reservedUnknownUsd: ledger.reservedUnknownUsd,
  }),
);
