'use client';
import {
  createContext,
  useContext,
  type ReactNode,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { MathfieldElement } from 'mathlive';
import 'mathlive/fonts.css';
import './math-input.css';
import {
  mathInputLatex,
  mathInputNumber,
  mathInputText,
} from '../services/editor-notation.ts';

type Props = {
  ref?: Ref<{ focus(): void }>;
  id?: string;
  name?: string;
  label: string;
  value?: string;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  onEscape?: () => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  describedBy?: string;
  required?: boolean;
  mixed?: boolean;
  graph?: boolean;
  numeric?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  invalid?: boolean;
  validate?: (source: string) => void;
};
const AutomaticKeyboard = createContext(false);
/** Lets a touch host open the mathematical keyboard whenever an editor gains focus. */
export function MathKeyboardProvider({
  children,
  automatic,
}: {
  children: ReactNode;
  automatic: boolean;
}) {
  return <AutomaticKeyboard value={automatic}>{children}</AutomaticKeyboard>;
}
let library: Promise<typeof import('mathlive')> | undefined;

/**
 * Edits structured mathematics while forms and voice keep using plain expressions.
 * Constant fields evaluate only for submission and retain their original notation.
 * Loading failures leave an editable text field; external updates preserve focus.
 */
export function MathInput(props: Props) {
  const automaticKeyboard = useContext(AutomaticKeyboard);
  const {
    ref,
    id,
    name,
    label,
    value,
    defaultValue = '',
    onChange,
    onEscape,
    placeholder,
    describedBy,
    mixed = false,
    graph = false,
    numeric = false,
    min,
    max,
    integer = false,
  } = props;
  const [draft, setDraft] = useState(String(defaultValue));
  const source = value ?? draft;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const latest = useRef({ props, source });
  useEffect(() => {
    latest.current = { props, source };
  });
  const rendered = useRef(source);
  let formValue = source;
  if (numeric) {
    try {
      formValue = String(mathInputNumber(source, min, max, integer));
    } catch {
      formValue = '';
    }
  }
  useImperativeHandle(
    ref,
    () => ({ focus: () => (field.current ?? fallback.current)?.focus() }),
    [],
  );

  useEffect(() => {
    const mobileKeyboard = window.matchMedia('(pointer: coarse)');
    const hideDesktopKeyboard = () => {
      if (!mobileKeyboard.matches) window.mathVirtualKeyboard?.hide();
    };
    mobileKeyboard.addEventListener('change', hideDesktopKeyboard);
    let disposed = false;
    library ??= import('mathlive');
    void library
      .then(({ MathfieldElement }) => {
        if (disposed || !host.current) return;
        // Vite serves the bundled fonts locally, including in offline workspaces.
        MathfieldElement.fontsDirectory = null;
        MathfieldElement.soundsDirectory = null;
        const input = new MathfieldElement();
        input.mathVirtualKeyboardPolicy = 'manual';
        input.addEventListener('focus', () => {
          latest.current.props.onFocus?.();
          if (automaticKeyboard && mobileKeyboard.matches) {
            const dialog = input.closest<HTMLElement>('[role="dialog"]');
            if (dialog) window.mathVirtualKeyboard.container = dialog;
            window.mathVirtualKeyboard?.show();
          }
        });
        input.addEventListener('blur', () => {
          window.mathVirtualKeyboard?.hide();
          latest.current.props.onBlur?.();
        });
        input.smartMode = mixed;
        input.mathModeSpace = mixed ? '\\:' : '';
        input.setValue(mathInputLatex(latest.current.source, mixed, graph), {
          silenceNotifications: true,
        });
        input.addEventListener('input', () => {
          const text = mathInputText(input.value, graph);
          rendered.current = text;
          setDraft(text);
          setError('');
          latest.current.props.onChange?.(text);
        });
        input.addEventListener('paste', (event) => {
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return;
          event.preventDefault();
          input.insert(mathInputLatex(text, mixed, graph), { format: 'latex' });
        });
        input.addEventListener(
          'keydown',
          (event) => {
            if (event.isComposing) return;
            // MathLive's smart-mode Space can remove a preceding comma when returning to math.
            if (mixed && input.mode === 'math' && event.key === ' ') {
              event.preventDefault();
              event.stopImmediatePropagation();
              input.insert('\\:', { format: 'latex', mode: 'math' });
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopImmediatePropagation();
              hidden.current?.form?.requestSubmit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopImmediatePropagation();
              setError('');
              window.mathVirtualKeyboard?.hide();
              latest.current.props.onEscape?.();
              // Keep workspace-wide audio cancellation after bypassing the editor's key handler.
              window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape' }),
              );
            }
          },
          { capture: true },
        );
        const hadFocus = fallback.current === document.activeElement;
        host.current.appendChild(input);
        // Keep command words such as “subtract” from becoming inline math shortcuts.
        if (mixed) input.inlineShortcuts = {};
        field.current = input;
        setReady(true);
        if (hadFocus) input.focus();
      })
      .catch(() => {
        library = undefined;
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      mobileKeyboard.removeEventListener('change', hideDesktopKeyboard);
      if (document.activeElement === field.current)
        window.mathVirtualKeyboard?.hide();
      field.current?.remove();
      field.current = null;
    };
  }, [mixed, graph, automaticKeyboard]);

  useEffect(() => {
    const input = field.current;
    if (!input) return;
    if (rendered.current !== source) {
      input.setValue(mathInputLatex(source, mixed, graph), {
        silenceNotifications: true,
      });
      rendered.current = source;
    }
    input.id = id ?? '';
    input.setAttribute('aria-label', label);
    input.setAttribute('aria-invalid', String(Boolean(error || props.invalid)));
    input.setAttribute(
      'aria-describedby',
      [describedBy, error ? errorId : ''].filter(Boolean).join(' '),
    );
    input.setAttribute('placeholder', `\\text{${placeholder ?? ''}}`);
  }, [
    graph,
    source,
    mixed,
    id,
    label,
    error,
    describedBy,
    placeholder,
    errorId,
    ready,
    props.invalid,
  ]);

  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const validate = (event: Event) => {
      const { props: current, source: text } = latest.current;
      try {
        if (text.length > 4000) throw new Error('Use at most 4000 characters.');
        if (current.required && !text.trim()) throw new Error('Enter a value.');
        if (current.numeric && (text.trim() || current.required))
          mathInputNumber(text, current.min, current.max, current.integer);
        current.validate?.(text);
      } catch (failure) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setError(
          failure instanceof Error ? failure.message : 'Check this value.',
        );
        (field.current ?? fallback.current)?.focus();
      }
    };
    const reset = () => {
      if (latest.current.props.value === undefined) {
        setDraft(String(latest.current.props.defaultValue ?? ''));
        setError('');
      }
    };
    form.addEventListener('submit', validate, true);
    form.addEventListener('reset', reset);
    return () => {
      form.removeEventListener('submit', validate, true);
      form.removeEventListener('reset', reset);
    };
  }, []);

  return (
    <div className="math-input" data-ready={ready}>
      <div ref={host} className="math-input-host" />
      {!ready && (
        <input
          ref={fallback}
          id={id}
          aria-label={label}
          aria-invalid={Boolean(error || props.invalid)}
          aria-describedby={[describedBy, error ? errorId : '']
            .filter(Boolean)
            .join(' ')}
          value={source}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
            onChange?.(event.target.value);
          }}
          onBlur={() => props.onBlur?.()}
          onFocus={() => props.onFocus?.()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setError('');
              onEscape?.();
            }
          }}
        />
      )}
      <input ref={hidden} type="hidden" name={name} value={formValue} />
      {error && (
        <span id={errorId} className="math-input-error" role="alert">
          {error}
        </span>
      )}
      {failed && (
        <output className="math-input-error">
          Math editor could not load. You can still type your expression.
        </output>
      )}
    </div>
  );
}
