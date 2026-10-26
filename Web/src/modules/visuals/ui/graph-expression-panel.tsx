'use client';
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/** Keeps display visibility through edits and matches surviving rows after removal.
 * The workspace remounts the graph panel when the student switches problems.
 */
export function useGraphVisibility(expressions: string[]) {
  const signature = JSON.stringify(expressions);
  const [state, setState] = useState({
    signature,
    expressions,
    hidden: [] as number[],
  });
  if (state.signature !== signature) {
    const used = new Set<number>();
    const hidden =
      expressions.length === state.expressions.length
        ? state.hidden
        : expressions.flatMap((expression, index) => {
            const previous = state.expressions.findIndex(
              (value, i) => value === expression && !used.has(i),
            );
            used.add(previous);
            return state.hidden.includes(previous) ? [index] : [];
          });
    setState({ signature, expressions, hidden });
  }
  return {
    hidden: state.hidden,
    toggle: (index: number) =>
      setState((previous) => ({
        ...previous,
        hidden: previous.hidden.includes(index)
          ? previous.hidden.filter((i) => i !== index)
          : [...previous.hidden, index],
      })),
  };
}

export function GraphExpressionPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="graph-expression-panel" aria-label="Graph expressions">
      <button
        type="button"
        className="graph-expression-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Expressions
        {open ? (
          <ChevronDown size={16} aria-hidden="true" />
        ) : (
          <ChevronUp size={16} aria-hidden="true" />
        )}
      </button>
      <div id={id} className="graph-expressions" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function GraphVisibility({
  index,
  color,
  hidden,
  onToggle,
}: {
  index: number;
  color: string;
  hidden: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="graph-visibility"
      style={{ color, opacity: hidden ? 0.35 : 1 }}
      aria-label={`${hidden ? 'Show' : 'Hide'} graph ${index + 1}`}
      aria-pressed={!hidden}
      onClick={onToggle}
    />
  );
}
