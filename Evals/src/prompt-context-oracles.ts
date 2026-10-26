import { compileGraphScene } from '../../Web/src/modules/visuals/index.ts';
import type { Workspace } from '../../Web/src/modules/workspace/state.ts';

/** Checks authored circle points and rejects the origin using computed implicit-relation membership. */
export function isRadiusTwoCircle(state: Workspace): boolean {
  if (!state.graphScene || state.graphScene.rows.length !== 1) return false;
  try {
    const compiled = compileGraphScene(state.graphScene);
    return (
      compiled.rows[0].kind === 'implicit' &&
      [
        [0, 2],
        [2, 0],
        [0, -2],
        [-2, 0],
      ].every(([x, y]) => compiled.contains(0, x, y)) &&
      !compiled.contains(0, 0, 0)
    );
  } catch {
    return false;
  }
}
