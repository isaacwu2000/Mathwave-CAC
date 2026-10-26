import type { PanelName } from '../types/panel-command.ts';
export type { PanelName } from '../types/panel-command.ts';

/** View-only commands keep the user on the current problem. */
export function panelCommand(
  text: string,
): { panel: PanelName; open: boolean } | null {
  const match = text
    .trim()
    .replace(/^please\s+/i, '')
    .replace(/[.!?]+$/, '')
    .match(
      /^(show|open|hide|close) (?:my |the )?(steps|work|voice settings|reading settings|saved problems|problem|more calculations)$/i,
    );
  if (!match) return null;
  const label = match[2].toLowerCase();
  const panel: PanelName =
    label === 'steps' || label === 'work'
      ? 'steps'
      : label.endsWith('settings')
        ? 'settings'
        : label === 'more calculations'
          ? 'calculations'
          : 'library';
  return { panel, open: /^(show|open)$/i.test(match[1]) };
}
