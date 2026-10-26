import { chromium, type Page } from "playwright";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  applyCloudOperation,
  createProblemLibrary,
  type CloudSnapshot,
  type CloudResponse,
  type CloudOperation,
} from "../../Web/src/modules/problems/index.ts";

type Fixture = Window & { emitPicoEvent?: (value: unknown) => void };
const origin = process.argv[2] || "http://localhost:3049";
const run = crypto.randomUUID();
const output = new URL(`../evaluations/pico-confetti-${run}/`, import.meta.url);
await mkdir(output, { recursive: true });
const checks: string[] = [],
  captures: { file: string; caption: string }[] = [];
const errors: string[] = [];
const videos: string[] = [];
let stage = "setup";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const emit = async (page: Page, value: unknown) =>
  page.evaluate((event) => (window as Fixture).emitPicoEvent?.(event), value);
const shot = async (page: Page, name: string, caption: string) => {
  const file = `${name}.png`;
  await page.screenshot({ path: new URL(file, output).pathname });
  captures.push({ file, caption });
};
const noBurst = async (page: Page) => {
  if (await page.locator(".pico-confetti").count()) throw new Error("Unexpected confetti.");
};
const playback = async (page: Page, active: boolean) => {
  await emit(page, { type: "playback.activity", active });
  await page.locator(`.pico[data-speaking="${active}"]`).waitFor();
};

/** Exercises the real worksheet and math service while isolating storage and voice transport. */
async function scenario(label: string, width: number, height: number) {
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: output.pathname, size: { width, height } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  let saved: CloudSnapshot = { book: createProblemLibrary(), clarification: null, revision: 0 };
  const receipts = new Map<string, CloudResponse>();
  let delay = 0,
    failSave = false;
  let release: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  let lastId = "";
  await page.route("**/api/live-token", (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST" ? { sdp: "synthetic answer" } : { configured: true },
    }),
  );
  await page.route("**/api/problems", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: saved });
    const body = route.request().postDataJSON() as {
      operation: CloudOperation;
      id: string;
      revision: number;
    };
    lastId = body.id;
    if (failSave) {
      failSave = false;
      return route.fulfill({ status: 503, json: { error: "Synthetic save failure." } });
    }
    if (receipts.has(body.id)) return route.fulfill({ json: receipts.get(body.id) });
    if (pending) await pending;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const result = await applyCloudOperation(saved, body.operation, async (text) =>
      text === "clarify this"
        ? { status: "clarification", command: "", message: "Which coefficient do you mean?" }
        : {
            status: "command",
            command: text === "start the example" ? "write 2*x+3=11" : text,
            message: "",
          },
    );
    const response = { ...result, revision: saved.revision + 1 };
    saved = response;
    receipts.set(body.id, response);
    await route.fulfill({ json: response });
  });
  await page.addInitScript(() => {
    const fixture = window as Fixture;
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext(),
        target = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      gain.gain.value = 0.02;
      oscillator.connect(gain);
      gain.connect(target);
      await audio.resume();
      oscillator.start();
      oscillator.stop(audio.currentTime + 3);
      return target.stream;
    };
    class Peer extends EventTarget {
      iceGatheringState = "complete";
      localDescription = { sdp: "synthetic offer" };
      channel = {
        readyState: "open",
        onmessage: null as ((event: MessageEvent) => void) | null,
        onopen: null as (() => void) | null,
        send() {},
        close() {},
      };
      createDataChannel() {
        fixture.emitPicoEvent = (value) =>
          this.channel.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
        return this.channel;
      }
      addTrack() {}
      close() {}
      async createOffer() {
        return this.localDescription;
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        setTimeout(() => fixture.emitPicoEvent?.({ type: "session.started" }), 0);
      }
    }
    window.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
  });
  const ready = async () => {
    await page.locator('.app-shell[data-ready="true"]').waitFor();
    await page.getByRole("button", { name: "Start listening", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("#voice-status")?.textContent?.includes("connected"),
    );
  };
  const command = async (text: string, wait = true) => {
    const previous = saved.revision;
    await emit(page, { type: "session.input_transcript.delta", delta: text });
    await emit(page, {
      type: "session.delegation.created",
      delegation: { id: crypto.randomUUID(), target: "client" },
    });
    if (wait) {
      await page.waitForFunction(() => !document.querySelector('.pico[data-working="true"]'));
      const until = Date.now() + 12000;
      while (saved.revision === previous && Date.now() < until)
        await new Promise((r) => setTimeout(r, 20));
      if (saved.revision === previous) throw new Error(`Command did not finish: ${text}`);
      await page.locator('.pico[data-working="false"]').waitFor();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    }
  };
  const newEquation = async (equation = "2*x+3=11") => {
    await command("new problem");
    await command(`write ${equation}`);
    await noBurst(page);
  };
  try {
    stage = `${label}: ready`;
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.locator('.app-shell[data-ready="true"]').waitFor();
    await shot(
      page,
      `${label}-01-ready`,
      `${width}×${height}: approved Soft peak, matching eyes, no idle animation.`,
    );
    await ready();
    await shot(page, `${label}-02-listening`, "Listening lean and input arrow; no speaking waves.");
    await playback(page, true);
    await shot(
      page,
      `${label}-03-speaking`,
      "Listening and audible playback overlap; outward waves are separate from the input waveform.",
    );
    await playback(page, false);
    if (
      (await page.locator(".pico-waves").evaluate((node) => getComputedStyle(node).display)) !==
      "none"
    )
      throw new Error("Waves survived interruption.");
    await page.getByRole("button", { name: "Your problems and account" }).click();
    await page.getByRole("switch", { name: "Spoken responses" }).click();
    await page.getByRole("button", { name: "Back to latest problem" }).click();
    await emit(page, { type: "playback.activity", active: true });
    await page.locator('.pico[data-speaking="false"]').waitFor();
    await shot(
      page,
      `${label}-03b-muted`,
      "Muted replies never animate speaking waves, even when a playback event arrives.",
    );
    await page.getByRole("button", { name: "Your problems and account" }).click();
    await page.getByRole("switch", { name: "Spoken responses" }).click();
    await page.getByRole("button", { name: "Back to latest problem" }).click();
    await playback(page, false);
    checks.push(
      `${label}: idle, listening, simultaneous playback, immediate interruption, and mute verified.`,
    );
    stage = `${label}: pending and expressions`;
    delay = 800;
    await command("start the example", false);
    await page.locator('.pico[data-working="true"]').waitFor();
    await playback(page, true);
    await shot(
      page,
      `${label}-04-overlap`,
      "Backend working, microphone listening, and speaking remain independent.",
    );
    await page.locator('.pico[data-working="false"]').waitFor();
    delay = 0;
    await playback(page, false);
    await command("clarify this");
    await page.locator('.pico[data-attention="clarifying"]').waitFor();
    await shot(
      page,
      `${label}-05-clarification`,
      "A calm clarification tilt while the student chooses what they meant.",
    );
    await command("never mind");
    await command("write x=5");
    await noBurst(page);
    await shot(
      page,
      `${label}-06-wrong-answer`,
      "Wrong answer x=5 stays saved and editable, without false celebration.",
    );
    await command("divide both sides by 0");
    await page.locator('.pico[data-attention="unavailable"]').waitFor();
    await noBurst(page);
    await shot(
      page,
      `${label}-06b-recovery`,
      "Unsupported division by zero keeps work intact and Pico calm.",
    );
    checks.push(
      `${label}: clarification, recovery, and incorrect-answer suppression verified through the real math service.`,
    );
    stage = `${label}: verified celebration`;
    await newEquation();
    const focusButton = page.getByRole("button", { name: "Stop listening", exact: true });
    await focusButton.focus();
    await command("write x=4");
    await page.locator(".pico-confetti").waitFor();
    await page.getByRole("status").filter({ hasText: "Solution verified. x = 4." }).waitFor();
    if (!(await focusButton.evaluate((node) => node === document.activeElement)))
      throw new Error("Confetti moved keyboard focus.");
    if (
      (await page
        .locator(".pico-confetti")
        .evaluate((node) => getComputedStyle(node).pointerEvents)) !== "none"
    )
      throw new Error("Overlay intercepts clicks.");
    // Sample two points on the actual bounded canvas timeline, rather than disabling animation for screenshots.
    await page.waitForTimeout(450);
    const painted = await page.locator("canvas.pico-confetti").evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 === 3 && value !== 0);
    });
    if (!painted) throw new Error("Confetti canvas is blank.");
    await shot(
      page,
      `${label}-07-launch`,
      "Verified x=4: the burst starts at Pico; controls and focus remain usable.",
    );
    await page.waitForTimeout(650);
    await shot(
      page,
      `${label}-08-confetti`,
      "Screen-wide red, peach, and gold particles; silent and non-interactive.",
    );
    await page.locator(".pico-confetti").waitFor({ state: "detached" });
    await shot(
      page,
      `${label}-09-complete`,
      "Particles clear after 2.2 seconds; verified text and saved mathematics remain.",
    );
    checks.push(
      `${label}: genuine verified-completion event paints a bounded burst, preserves focus, ignores clicks, and cleans up.`,
    );
    await command("solve");
    await page.locator(".pico-confetti").waitFor();
    await page.locator(".pico-confetti").waitFor({ state: "detached" });
    const repeatedRevision = saved.revision;
    await emit(page, {
      type: "session.delegation.created",
      delegation: { id: lastId, target: "client" },
    });
    await page.waitForTimeout(120);
    if (saved.revision !== repeatedRevision)
      throw new Error("Duplicate delegation executed twice.");
    await noBurst(page);
    await page.reload();
    await ready();
    await noBurst(page);
    await command("solve");
    await page.locator(".pico-confetti").waitFor();
    await page.locator(".pico-confetti").waitFor({ state: "detached" });
    checks.push(
      `${label}: new confirmed results can celebrate; duplicate delivery and reload stay quiet.`,
    );
    stage = `${label}: history replay`;
    await command("undo");
    await page.evaluate(
      (id) => localStorage.removeItem(`mathwave-celebrated:${id}`),
      saved.book.problemId,
    );
    await command("redo");
    await noBurst(page);
    if (receipts.get(lastId)?.completion) throw new Error("Redo emitted a fresh completion.");
    await shot(
      page,
      `${label}-09b-history`,
      "Redo in a browser without a celebration receipt stays quiet: restored work is not a fresh completion.",
    );
    checks.push(`${label}: history replay emits no completion even without a local receipt.`);
    stage = `${label}: reduced motion`;
    await newEquation("3*x=1");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await command("write x=1/3");
    await page
      .locator(".pico-success")
      .filter({ hasText: "Solution verified. x = 1/3." })
      .waitFor();
    if (
      await page.locator(".pico").evaluate((node) => node.getAnimations({ subtree: true }).length)
    )
      throw new Error("Reduced motion still animates Pico.");
    if (
      (await page.locator(".pico-confetti").evaluate((node) => getComputedStyle(node).display)) !==
      "none"
    )
      throw new Error("Reduced motion shows particles.");
    await shot(
      page,
      `${label}-10-reduced-motion`,
      "Exact fraction verified with a still, accessible confirmation and no moving particles.",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    checks.push(
      `${label}: reduced motion keeps readable status while suppressing both Pico and confetti motion.`,
    );
    stage = `${label}: disabled preference`;
    await page.getByRole("button", { name: "Your problems and account" }).click();
    await page.getByRole("switch", { name: "Confetti celebrations" }).click();
    await shot(
      page,
      `${label}-11-settings`,
      "Celebrations can be disabled separately from spoken responses.",
    );
    await page.getByRole("button", { name: "Back to latest problem" }).click();
    await newEquation();
    await command("solve");
    await page.locator(".pico-success").waitFor();
    await noBurst(page);
    await shot(
      page,
      `${label}-12-disabled`,
      "Disabled celebrations retain the verified result without a burst.",
    );
    await page.reload();
    await ready();
    if (
      (await page.evaluate(() => localStorage.getItem("mathwave-celebrations-enabled"))) !== "false"
    )
      throw new Error("Preference did not survive reload.");
    checks.push(
      `${label}: disabled preference persists across reload, and no ordinary command or unsupported work celebrates.`,
    );
    stage = `${label}: unsupported objective`;
    await newEquation("x^2=4");
    await command("write x=2");
    await noBurst(page);
    if (receipts.get(lastId)?.completion)
      throw new Error("An incomplete quadratic root set was verified.");
    await shot(
      page,
      `${label}-12b-unsupported`,
      "A single root of a quadratic is incomplete; unsupported objectives do not celebrate.",
    );
    checks.push(
      `${label}: nonlinear/incomplete solution sets cannot trigger a verified celebration.`,
    );
    stage = `${label}: stale result after navigation`;
    await page.getByRole("button", { name: "Your problems and account" }).click();
    await page.getByRole("switch", { name: "Confetti celebrations" }).click();
    await page.getByRole("button", { name: "Back to latest problem" }).click();
    await newEquation();
    pending = new Promise((resolve) => {
      release = resolve;
    });
    await command("solve", false);
    await page.locator('.pico[data-working="true"]').waitFor();
    await page.getByRole("button", { name: "Your problems and account" }).click();
    release!();
    pending = undefined;
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Back to latest problem" }).click();
    await noBurst(page);
    await shot(
      page,
      `${label}-13-stale`,
      "A result arriving after navigation does not launch delayed confetti when returning.",
    );
    checks.push(
      `${label}: navigation invalidates an in-flight celebration without losing the confirmed mathematical result.`,
    );
    stage = `${label}: failed save and retry`;
    await newEquation();
    failSave = true;
    await command("write x=4", false);
    await page.locator('.pico[data-attention="unavailable"]').waitFor();
    await noBurst(page);
    await shot(
      page,
      `${label}-13b-save-failure`,
      "An unconfirmed save cannot trigger a celebration; work and retry remain available.",
    );
    await command("read");
    await noBurst(page);
    checks.push(
      `${label}: failed save produces no burst; confirming its retained request does not replay a recovered celebration.`,
    );
    stage = `${label}: hidden page`;
    await newEquation();
    await command("solve");
    await page.locator(".pico-confetti").waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.locator(".pico-confetti").waitFor({ state: "detached" });
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await noBurst(page);
    await shot(
      page,
      `${label}-14-hidden-return`,
      "Hiding the page cancels the burst; returning does not replay it.",
    );
    checks.push(`${label}: hidden-page cancellation and return do not replay confetti.`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Horizontal overflow.");
    checks.push(`${label}: no horizontal overflow at ${width}×${height}.`);
  } catch (error) {
    await shot(page, `${label}-failure`, `${stage}: ${String(error)}`);
    throw error;
  } finally {
    release?.();
    const videoPath = await page.video()?.path();
    await context.close();
    if (videoPath) {
      const videoFile = `${label}.webm`;
      await rename(videoPath, new URL(videoFile, output).pathname);
      videos.push(videoFile);
    }
  }
}
let failure: string | undefined;
try {
  await scenario("desktop", 1280, 900);
  await scenario("mobile", 390, 844);
  if (errors.length) throw new Error(errors.join("; "));
} catch (error) {
  failure = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
  process.exitCode = 1;
} finally {
  await browser.close();
  const report = {
    run,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    environment:
      "Local Vinext app; actual applyCloudOperation and exact completion service; synthetic voice transport and isolated in-memory storage. No live provider or student data.",
    passed: !failure,
    checks,
    failure,
    captures,
    videos,
  };
  await writeFile(new URL("report.json", output), JSON.stringify(report, null, 2) + "\n");
  const escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  await writeFile(
    new URL("report.html", output),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pico and confetti browser verification</title><style>body{font:18px/1.6 system-ui;margin:40px auto;max-width:1200px;padding:0 24px;color:#292725;background:#fff9f5}h1{line-height:1.2}figure{margin:32px 0;background:white;padding:24px;border-radius:16px}img{max-width:100%;height:auto;display:block;max-height:750px;object-fit:contain;object-position:left}figcaption{margin-top:16px}li{margin:8px 0}a{color:#9b392e}</style><h1>Pico and confetti browser verification</h1><p>${report.passed ? "Passed" : "Failed"} · ${escape(report.environment)}</p><p>Base revision ${report.revision}; uncommitted implementation under test. Desktop 1280×900 and narrow 390×844.</p>${failure ? `<p>${escape(failure)}</p>` : ""}<ul>${checks.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>${videos.map((v) => `<p><a href="${v}">${v}</a></p><video controls preload="metadata" style="max-width:100%;max-height:600px" src="${v}"></video>`).join("")}${captures.map((c) => `<figure><a href="${c.file}"><img src="${c.file}" alt="${escape(c.caption)}" loading="lazy"></a><figcaption>${escape(c.caption)}</figcaption></figure>`).join("")}</html>`,
  );
  console.log(
    JSON.stringify({
      output: output.pathname,
      checks: checks.length,
      captures: captures.length,
      failure,
    }),
  );
}
