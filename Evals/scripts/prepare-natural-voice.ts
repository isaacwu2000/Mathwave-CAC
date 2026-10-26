import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { naturalVoiceCases } from "../src/natural-voice-conversation.ts";
import { fileURLToPath } from "node:url";

const directory = new URL("../../Web/public/demo-voices/natural-conversation/", import.meta.url);
await mkdir(directory, { recursive: true });
const manifest = [];
for (const example of naturalVoiceCases) {
  const output = new URL(`${example.id}.wav`, directory);
  execFileSync("say", [
    "-v",
    "Daniel",
    "-r",
    "175",
    "--file-format=WAVE",
    "--data-format=LEI16@24000",
    "-o",
    fileURLToPath(output),
    example.text,
  ]);
  manifest.push({
    id: example.id,
    voice: "Daniel",
    text: example.text,
    audio: `/demo-voices/natural-conversation/${example.id}.wav`,
    sha256: createHash("sha256")
      .update(await readFile(output))
      .digest("hex"),
    source: "macOS installed speech synthesis",
  });
}
await writeFile(new URL("manifest.json", directory), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Prepared ${manifest.length} synthetic voice recordings; no model calls.`);
