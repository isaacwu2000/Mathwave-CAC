import type { Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMath, speakMath } from '../../Web/src/modules/math/index.ts';
import { describeGeometry } from '../../Web/src/modules/visuals/index.ts';
import type { Workspace } from '../../Web/src/modules/workspace/state.ts';

type ScreenContent = {
  visible: boolean;
  text: string;
  mathLabels: string[];
  graphExpressions?: string[];
};

/** Checks rendered mathematical content, including the empty state before the first saved step. */
export function screenMatchesWork(
  state: Workspace,
  savedSteps: number,
  screen: ScreenContent,
) {
  if (!screen.visible) return false;
  if (state.mode === 'equation' && !savedSteps)
    return screen.text.includes('What math shall we play with today?');
  if (state.graphScene)
    return state.graphScene.rows.every(
      (row, index) =>
        row.expression.replace(/\s/g, '') ===
        screen.graphExpressions?.[index]?.replace(/\s/g, ''),
    );
  if (state.mode === 'equation' && state.expression && !state.graphScene)
    return screen.mathLabels.includes(speakMath(parseMath(state.expression)));
  if (state.mode === 'geometry' && state.geometry)
    return screen.text.includes(describeGeometry(state.geometry));
  if (state.mode === 'statistics')
    return screen.text.includes(state.data.join(', '));
  return true;
}

/** Saves pixels and visible workspace text for agent inspection; checks rendered work against saved work.
 * Screenshot capture is evidence, not an automated judgement of visual quality.
 */
export async function captureScreenEvidence(
  page: Page,
  directory: string,
  name: string,
  state: Workspace,
  savedSteps: number,
) {
  await mkdir(directory, { recursive: true });
  const screenshot = resolve(directory, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const workspace = page.getByLabel('Math workspace', { exact: true });
  const text = await workspace.innerText();
  const mathLabels = await workspace
    .locator('math:visible')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    );
  const graphExpressions = await workspace
    .locator('math-field[aria-label^="Graph expression "]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement & { value: string }).value),
    );
  const matchesSavedWork = screenMatchesWork(state, savedSteps, {
    // The drawing is positioned inside a parent that can legitimately have zero layout height.
    visible:
      (await workspace.isVisible()) ||
      (await workspace.locator('canvas:visible').count()) > 0,
    text,
    mathLabels,
    graphExpressions,
  });
  return { screenshot, text, mathLabels, graphExpressions, matchesSavedWork };
}
