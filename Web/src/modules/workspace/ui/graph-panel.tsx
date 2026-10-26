'use client';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { MathKeyboardProvider } from '../../math/ui.ts';

const compactQuery = '(max-width: 900px), (hover: none) and (pointer: coarse)';
function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Shows a separate graph view on phones/tablets, retaining the laptop split view.
 * The modal handles focus, Escape and background scrolling while it is open.
 */
export function GraphPanel({ children }: { children: ReactNode }) {
  const compact = useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [lastCompact, setLastCompact] = useState(compact);
  const closeButton = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  if (lastCompact !== compact) {
    setLastCompact(compact);
    setOpen(false);
  }
  // MathLive normally places its keyboard on the page. Keep it in the modal's
  // focus boundary and reserve its height so the expression editor stays visible.
  useEffect(() => {
    if (!compact || !open) return;
    let keyboard: typeof window.mathVirtualKeyboard | undefined;
    const resize = () => {
      popup.current?.style.setProperty(
        '--graph-keyboard-height',
        `${keyboard?.boundingRect.height ?? 0}px`,
      );
    };
    const connect = () => {
      if (keyboard || !popup.current || !window.mathVirtualKeyboard) return;
      keyboard = window.mathVirtualKeyboard;
      keyboard.container = popup.current;
      keyboard.addEventListener('geometrychange', resize);
      resize();
    };
    connect();
    window.addEventListener('focusin', connect);
    return () => {
      window.removeEventListener('focusin', connect);
      if (keyboard) {
        keyboard.removeEventListener('geometrychange', resize);
        keyboard.hide();
        keyboard.container = document.body;
      }
    };
  }, [compact, open]);
  return (
    <Dialog.Root open={compact && open} onOpenChange={setOpen}>
      <Dialog.Trigger className="graph-launcher" aria-label="Show graph">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 18h18M12 3v18" strokeWidth="1.5" opacity="0.45" />
          <path
            d="M4 4Q12 32 20 4"
            stroke="var(--accent-700)"
            strokeWidth="1.8"
          />
        </svg>
        Graph
      </Dialog.Trigger>
      {compact ? (
        <Dialog.Portal>
          <Dialog.Popup
            ref={popup}
            className="graph-fullscreen graph-card learnunlock-controls"
            initialFocus={closeButton}
          >
            <Dialog.Title className="sr-only">Graph</Dialog.Title>
            <Dialog.Close
              ref={closeButton}
              className="graph-fullscreen-close"
              aria-label="Close graph"
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
            <div className="graph-panel-body">
              <MathKeyboardProvider automatic>{children}</MathKeyboardProvider>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      ) : (
        <section
          className="graph-card graph-desktop learnunlock-controls"
          aria-label="Graph"
        >
          <div className="graph-panel-body">{children}</div>
        </section>
      )}
    </Dialog.Root>
  );
}
