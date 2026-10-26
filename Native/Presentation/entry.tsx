import React, { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { decodeProblemLibrary, currentProblem } from "../../Web/src/modules/problems/index.ts";
import { displayNumber, parseMath } from "../../Web/src/modules/math/index.ts";
import { MathInput, MathKeyboardProvider } from "../../Web/src/modules/math/ui.ts";
import {
  GraphView,
  GeometryView,
  Chart,
  mathElement,
  GraphSceneNotation,
  ExplorationView,
} from "../../Web/src/modules/visuals/ui.ts";
import { EquationCarousel, GraphPanel } from "../../Web/src/modules/workspace/ui.ts";
import { statistics } from "../../Web/src/modules/math/index.ts";
import { stepReadback } from "./readback.ts";
import "./presentation.css";

type Snapshot = {
  library: string;
  draft: string;
  mode: "workspace" | "composer" | "export";
  scale: number;
  dark: boolean;
  revisionDrafts: Record<string, string>;
  renderID?: number;
  showControls?: boolean;
};
declare global {
  interface Window {
    webkit: {
      messageHandlers: { mathwave: { postMessage(value: unknown): void } };
    };
    Mathwave: {
      receive(base64: string): void;
      resolve(id: number, ok: boolean, error: string): void;
    };
  }
}
function reportDisplayError(error: unknown) {
  window.webkit.messageHandlers.mathwave.postMessage({
    operation: "display-error",
    message: String(error),
  });
}
window.addEventListener("error", (event) => reportDisplayError(event.message));
window.addEventListener("unhandledrejection", (event) => reportDisplayError(event.reason));
class DisplayBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportDisplayError(error.message);
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        Math display could not load. Your saved work is safe. Reopen your problem to retry.
      </p>
    ) : (
      this.props.children
    );
  }
}
let sequence = 0;
let observingKeyboard = false;
let problemId = "";
let revisionDrafts: Record<string, string> = {};
const pending = new Map<number, { resolve(): void; reject(error: Error): void }>();
/** Native owns validation, atomic saves, audio and undo. The view only requests actions. */
function send(operation: string, text = "", index = 0, sourceProblem = problemId): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    window.webkit.messageHandlers.mathwave.postMessage({
      id,
      operation,
      text,
      index,
      problemId: sourceProblem,
      readResult:
        operation === "command" &&
        /^(evaluate|describe shape|next step|next point|previous point)/i.test(text),
    });
  });
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => {
    document.addEventListener("focusin", observeKeyboard, true);
    return () => document.removeEventListener("focusin", observeKeyboard, true);
  }, []);
  useEffect(() => {
    if (snapshot?.mode === "export") {
      void document.fonts.ready.then(() =>
        window.webkit.messageHandlers.mathwave.postMessage({
          operation: "export-ready",
        }),
      );
    }
  }, [snapshot]);
  const confirmRender = () => {
    if (snapshot)
      void document.fonts.ready.then(() =>
        requestAnimationFrame(() =>
          window.webkit.messageHandlers.mathwave.postMessage({
            operation: "rendered",
            renderID: snapshot.renderID,
          }),
        ),
      );
  };
  const [failure, setFailure] = useState("");
  const [focus, setFocus] = useState<{ key: string; index: number }>();
  useEffect(() => {
    window.Mathwave = {
      receive(base64) {
        const value = JSON.parse(
          new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))),
        ) as Snapshot;
        document.documentElement.style.fontSize = `${17 * value.scale}px`;
        document.documentElement.style.setProperty("--native-text-scale", String(value.scale));
        document.documentElement.classList.toggle("dark", value.dark);
        problemId = currentProblem(decodeProblemLibrary(value.library)).id;
        revisionDrafts = value.revisionDrafts;
        setSnapshot(value);
      },
      resolve(id, ok, error) {
        const callback = pending.get(id);
        pending.delete(id);
        if (ok) callback?.resolve();
        else callback?.reject(new Error(error));
      },
    };
    window.webkit.messageHandlers.mathwave.postMessage({ operation: "ready" });
    const observer = new ResizeObserver(() =>
      window.webkit.messageHandlers.mathwave.postMessage({
        operation: "height",
        height:
          (document.getElementById("root")?.scrollHeight ?? 120) +
          (window.mathVirtualKeyboard?.visible
            ? window.mathVirtualKeyboard.boundingRect.height
            : 0),
      }),
    );
    observer.observe(document.getElementById("root")!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const p = currentProblem(decodeProblemLibrary(snapshot.library));
    const k = `${p.id}:${p.steps.at(-1)?.at}:${p.steps.length}`;
    const displayed =
      focus?.key === k && focus.index < p.steps.length - 1 ? p.steps[focus.index].state : p.state;
    const drawing =
      (p.state.mode === "equation" && displayed.graph) ||
      (p.state.mode === "geometry" && (p.state.geometry || p.state.construction));
    if (snapshot.mode === "workspace" && !snapshot.showControls && drawing) {
      window.mathVirtualKeyboard?.hide();
      document.body.style.paddingBottom = "0px";
    }
    if (!drawing || snapshot.mode !== "workspace") confirmRender();
  }, [snapshot, focus]);
  if (!snapshot) return <output>Opening your work…</output>;
  const problem = currentProblem(decodeProblemLibrary(snapshot.library));
  const key = `${problem.id}:${problem.steps.at(-1)?.at}:${problem.steps.length}`;
  const index = focus?.key === key ? focus.index : problem.steps.length - 1;
  const state = problem.state;
  const reviewed = index < problem.steps.length - 1;
  const graphSource = reviewed ? problem.steps[index].state : state;
  const graph = graphSource.retainedGraph
    ? { ...graphSource, graphScene: graphSource.retainedGraph }
    : graphSource;
  const equationGeometry =
    state.mode === "equation" && !graph.graph && Boolean(state.geometry || state.construction);
  const request = (operation: string, text = "", index = 0) =>
    send(operation, text, index, problem.id);
  const command = (text: string) => {
    void request("command", text).catch((e) => setFailure(e.message));
  };
  if (snapshot.mode === "export")
    return (
      <article className="print-work">
        <h1>{problem.title}</h1>
        <ol>
          {problem.steps.map((step, i) => (
            <li key={i}>
              {step.state.mode === "equation" ? (
                step.state.graphScene ? (
                  <GraphSceneNotation scene={step.state.graphScene} />
                ) : (
                  createElement("math", {}, mathElement(parseMath(step.state.expression)))
                )
              ) : (
                <p>{step.displayCommand || step.command}</p>
              )}
            </li>
          ))}
        </ol>
        {snapshot.draft && <p>Unsubmitted command: {snapshot.draft}</p>}
      </article>
    );
  if (snapshot.mode === "composer")
    return (
      <>
        <MathInput
          id="command.input"
          label="Math or command input"
          value={snapshot.draft}
          mixed
          onChange={(value) => {
            void request("draft", value);
          }}
        />
      </>
    );
  return (
    <main
      className={`native-presentation ${!snapshot.showControls && (graph.graph || state.mode === "geometry") ? "drawing-only" : ""}`}
    >
      {failure && <p role="alert">{failure}</p>}
      {state.mode === "equation" && problem.steps.length > 0 && (
        <div className="problem-canvas">
          {(!graph.graph || !!state.retainedGraph || snapshot.showControls) && (
            <div className="equation-column">
              <EquationCarousel
                key={problem.id}
                holdActions
                onStepAction={(step, action) => {
                  if (action === "read")
                    void request(
                      "read",
                      `Step ${step}. ${stepReadback(problem.steps[step - 1].state.expression)}`,
                    );
                  else command(`cancel step ${step}`);
                }}
                problem={problem}
                focused={index}
                busy={false}
                revisionStorage={{
                  getItem: (key) => revisionDrafts[key] ?? null,
                  setItem(key, value) {
                    revisionDrafts[key] = value;
                    void request("revision-draft", JSON.stringify({ key, value }));
                  },
                  removeItem(key) {
                    delete revisionDrafts[key];
                    void request("revision-draft", JSON.stringify({ key }));
                  },
                }}
                onFocus={(i) => {
                  setFocus({ key, index: i });
                  window.webkit.messageHandlers.mathwave.postMessage({
                    operation: "focus",
                    problemId: problem.id,
                    step: i + 1,
                  });
                }}
                onRevise={(step, expression) => request("revise", expression, step)}
                onBranch={(i) => request("branch", "", i)}
              />
            </div>
          )}
          {equationGeometry && (
            <GraphPanel key={problem.id}>
              <GeometryView
                controls={false}
                geometry={state.geometry}
                construction={state.construction}
                overlay={state.geometryOverlay}
                canUndo={!!problem.undoRevisions?.length}
                onCommand={command}
                onRendered={confirmRender}
              />
            </GraphPanel>
          )}
          {graph.graph && (
            <div className="graph-card learnunlock-controls">
              {reviewed && (
                <p className="review-note">
                  Viewing the graph saved at step {index + 1}. Return to the latest step to change
                  it.
                </p>
              )}
              <fieldset disabled={reviewed} className="graph-preview-controls">
                <GraphView
                  key={problem.id}
                  controls={snapshot.showControls ?? false}
                  expression={graph.expression}
                  expressions={graph.graphExpressions}
                  scene={graph.graphScene}
                  range={graph.graphRange}
                  yRange={graph.graphYRange}
                  trace={graph.graphTrace}
                  comparisonPoints={graph.graphComparison}
                  onCommand={command}
                  interactive={!reviewed}
                  onRendered={confirmRender}
                />
              </fieldset>
            </div>
          )}
        </div>
      )}
      {state.mode === "geometry" && (
        <GeometryView
          controls={snapshot.showControls ?? false}
          geometry={state.geometry}
          construction={state.construction}
          overlay={state.geometryOverlay}
          canUndo={!!problem.undoRevisions?.length}
          onCommand={command}
          onRendered={confirmRender}
        />
      )}

      {state.mode === "statistics" && (
        <Statistics values={state.data} selected={state.selection} command={command} />
      )}
      {problem.exploration && (
        <ExplorationView
          lesson={problem.exploration}
          onChange={(name, value) => {
            void request("adjust", name, value);
          }}
          onSpeak={(text) => {
            void request("read", text);
          }}
          onDismiss={() => {
            void request("dismiss-explanation");
          }}
        />
      )}
    </main>
  );
}
function Statistics({
  values,
  selected,
  command,
}: {
  values: number[];
  selected: number;
  command(text: string): void;
}) {
  const stat = statistics(values);
  return (
    <section className="math-card">
      <div className="card-heading">
        <span>Data · {values.length} VALUES</span>
      </div>
      <details className="inline-panel extra-calculations">
        <summary>More calculations</summary>
        <div className="equation-actions" aria-label="Statistics calculations">
          {[
            "Mode",
            "Range",
            "Sum",
            "Count",
            "Sample standard deviation",
            "Population standard deviation",
          ].map((text) => (
            <button className="soft-button" key={text} onClick={() => command(text)}>
              {text}
            </button>
          ))}
        </div>
      </details>
      <div className="stat-grid">
        <div>
          <span>Mean</span>
          <strong>{displayNumber(stat.mean)}</strong>
        </div>
        <div>
          <span>Median</span>
          <strong>{displayNumber(stat.median)}</strong>
        </div>
        <div>
          <span>Potential outliers</span>
          <strong>{stat.outliers.length}</strong>
        </div>
      </div>
      <Chart
        values={values}
        labels={["Observation 1", `Observation ${values.length}`]}
        selected={selected}
        onSelect={(i) => command(`read point ${i + 1}`)}
      />
      <div className="data-values">
        <strong>Data</strong> {values.map(displayNumber).join(", ")}
      </div>
      <p>
        Potential outliers use the 1.5 × IQR rule. A flag is a prompt to investigate, not a reason
        to remove a value.
      </p>
      <div className="part-navigation">
        <button
          disabled={selected <= 0}
          aria-label="Previous point"
          onClick={() => command("previous point")}
        >
          Previous
        </button>
        <span>
          Observation {selected + 1}: {displayNumber(values[selected] ?? 0)}
        </span>
        <button
          disabled={selected >= values.length - 1}
          aria-label="Next point"
          onClick={() => command("next point")}
        >
          Next
        </button>
      </div>
      <div className="equation-actions">
        {["Mean", "Median", "Find outliers", "Read data", "Play data"].map((text) => (
          <button className="soft-button" key={text} onClick={() => command(text)}>
            {text}
          </button>
        ))}
      </div>
    </section>
  );
}
/** Keep the embedded page clear of the on-screen keyboard without adding a second toggle. */
function observeKeyboard() {
  const keyboard = window.mathVirtualKeyboard;
  if (!keyboard || observingKeyboard) return;
  observingKeyboard = true;
  const geometryChanged = () => {
    document.body.style.paddingBottom = `${keyboard.visible ? keyboard.boundingRect.height : 0}px`;
    const active = document.activeElement;
    if (keyboard.visible && active?.tagName.toLowerCase() === "math-field") {
      const rect = active.getBoundingClientRect();
      const visibleHeight = window.innerHeight - keyboard.boundingRect.height;
      window.scrollBy({
        top: rect.top - Math.max(12, (visibleHeight - rect.height) / 2),
        behavior: "instant",
      });
    }
    window.webkit.messageHandlers.mathwave.postMessage({
      operation: "height",
      height:
        (document.getElementById("root")?.scrollHeight ?? 120) +
        (keyboard.visible ? keyboard.boundingRect.height : 0),
    });
  };
  keyboard.addEventListener("geometrychange", geometryChanged);
  geometryChanged();
}
createRoot(document.getElementById("root")!).render(
  <DisplayBoundary>
    <MathKeyboardProvider automatic>
      <App />
    </MathKeyboardProvider>
  </DisplayBoundary>,
);
