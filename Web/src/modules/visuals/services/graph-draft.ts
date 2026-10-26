import { graphFunction } from './graph.ts';

/** Validates a draft without saving; an invalid edit retains the previous curve. */
export function previewGraphDraft(previous: string, source: string) {
  try {
    graphFunction(source);
    return { expression: source, source, error: '' };
  } catch (error) {
    return {
      expression: previous,
      source,
      error: error instanceof Error ? error.message : 'Check this expression.',
    };
  }
}

/** Only valid changes to the plotted expression create an autosave, not notation changes. */
export function graphDraftChanged(saved: string, source: string) {
  try {
    return (
      JSON.stringify(graphFunction(saved).node) !==
      JSON.stringify(graphFunction(source).node)
    );
  } catch {
    return false;
  }
}
