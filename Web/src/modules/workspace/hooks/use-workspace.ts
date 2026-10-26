'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCelebration } from './use-celebration.ts';
import { scopedStorage } from '../../accounts/index.ts';
import { useAccount } from '../../accounts/ui.ts';
import type { ClarificationContext } from '../../commands/index.ts';
import {
  directMathCommand,
  isGraphBuildRequest,
  isGraphClarificationAnswer,
  previewGraphCommands,
  type PanelName,
} from '../../commands/index.ts';
import { parseMath, statistics } from '../../math/index.ts';
import {
  CloudProblemLibraryClient,
  GraphBuildClient,
  GraphBuildError,
  blankWorkspace,
  currentProblem,
  currentProblemText,
  historyContext,
  problemLibraryText,
  type CloudOperation,
  type CloudResponse,
  type CloudSnapshot,
  type ProblemLibrary,
  type InterpretationProgress,
} from '../../problems/index.ts';
import { journeyPoint, journeySpan } from '../../diagnostics/index.ts';
import { curvePoints } from '../../visuals/index.ts';
import { useAudio } from '../../voice/ui.ts';
import { partsFor } from '../services/state.ts';
import { DrawingReceipt, drawingKey } from '../services/drawing-receipt.ts';
import type { Workspace } from '../types/index.ts';
/** Owns problem coordination, draft recovery and voice/graph lifecycle for the workspace.
 * Keeps operation ordering and cancellation identical across every rendered control.
 */
export function useWorkspace(
  recording = false,
  onPdfExport?: (book: ProblemLibrary) => void,
) {
  const account = useAccount();
  const owner = account?.status.identity.owner;
  const ownedFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (owner) headers.set('X-Mathwave-Owner', owner);
    return fetch(url, { ...init, headers });
  };
  const pendingDisplay = useRef<string | null>(null);
  const pendingPreview = useRef<string | null>(null);
  useEffect(() => {
    if (pendingPreview.current) {
      journeyPoint(pendingPreview.current, 'preview-display-commit');
      pendingPreview.current = null;
    }
    const id = pendingDisplay.current;
    if (!id) return;
    pendingDisplay.current = null;
    journeyPoint(id, 'display-commit');
  });
  const [state, setState] = useState<Workspace>(blankWorkspace()),
    [input, setInput] = useState(''),
    [spoken, setSpoken] = useState(true),
    [rate, setRate] = useState(1),
    [help, setHelp] = useState(false),
    [response, setResponse] = useState(''),
    [error, setError] = useState(false),
    [noticeVersion, setNoticeVersion] = useState(0);
  const [voiceAvailability, setVoiceAvailability] = useState<
    'checking' | 'ready' | 'unconfigured' | 'unknown'
  >('checking');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let active = true;
    fetch('/api/live-token', { signal: controller.signal, cache: 'no-store' })
      .then(async (result) => {
        if (!result.ok) throw new Error('Status unavailable');
        const status = await result.json();
        if (
          !status ||
          typeof status !== 'object' ||
          !('configured' in status) ||
          typeof status.configured !== 'boolean'
        )
          throw new Error('Invalid voice status');
        if (active)
          setVoiceAvailability(
            status.configured === true ? 'ready' : 'unconfigured',
          );
      })
      .catch(() => {
        if (active) setVoiceAvailability('unknown');
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  const pendingClarification = useRef<
    (ClarificationContext & { workspace: Workspace }) | null
  >(null);
  const [clarifying, setClarifying] = useState(false);
  const setClarification = (
    value: (ClarificationContext & { workspace: Workspace }) | null,
  ) => {
    pendingClarification.current = value;
    setClarifying(Boolean(value));
  };
  const stateRef = useRef(state),
    field = useRef<{ focus(): void }>(null),
    submitRef = useRef<
      (
        text: string,
        forceAudio?: boolean,
        fromVoice?: boolean,
        fromComposer?: boolean,
        interpreted?: boolean,
      ) => void
    >(() => {});
  const [book, setBook] = useState<ProblemLibrary | null>(null);
  const {
    celebration,
    enabled: celebrationsEnabled,
    setEnabled: setCelebrationsEnabled,
    cancel: cancelCelebration,
    showVerified,
  } = useCelebration();
  const recordingCompletion = useRef<(() => void) | null>(null);
  const historyCount = book ? historyContext(book).undoCount : 0;
  const [panels, setPanels] = useState<Record<PanelName, boolean>>({
    steps: false,
    settings: false,
    library: false,
    calculations: false,
  });
  const [aiStatus, setAIStatus] = useState('AI interprets commands first');
  const importField = useRef<HTMLInputElement>(null);
  const [saveStatus, setSaveStatus] = useState('Loading saved work…');
  const bookRef = useRef<ProblemLibrary | null>(null);
  const unsaved = useRef(false);
  const liveRevision = useRef(0);
  const notifyRef = useRef<
    (message: string, isError?: boolean, forceAudio?: boolean) => void
  >(() => {});
  const [cloud] = useState(() => {
    try {
      return new CloudProblemLibraryClient(
        ownedFetch,
        owner
          ? scopedStorage(window.sessionStorage, owner)
          : window.sessionStorage,
      );
    } catch {
      return new CloudProblemLibraryClient(ownedFetch);
    }
  });
  const [graphBuilder] = useState(() => new GraphBuildClient(ownedFetch));
  type Build = {
    text: string;
    commands: string[];
    revision: number;
    phase: 'building' | 'saving' | 'failed' | 'save-unconfirmed';
    message: string;
  };
  const [graphBuild, setGraphBuild] = useState<Build | null>(null);
  const [commandProgress, setCommandProgress] = useState<{
    phase: 'working' | 'graphing' | InterpretationProgress['phase'];
    workspace?: Workspace;
    steps?: InterpretationProgress['steps'];
  } | null>(null);
  const graphBuildRef = useRef<Build | null>(null);
  const graphEpoch = useRef(0);
  const graphTiming = useRef<{
    epoch: number;
    start: number;
    first: boolean;
  } | null>(null);
  const [drawingReceipt] = useState(() => new DrawingReceipt());
  useEffect(() => {
    drawingReceipt.activate();
    return () => drawingReceipt.dispose();
  }, [drawingReceipt]);
  useEffect(() => {
    if (state.mode !== 'geometry') drawingReceipt.invalidate();
  }, [state.mode, drawingReceipt]);
  const graphRendered = (rendered: Workspace) => {
    if (rendered.mode === 'geometry')
      drawingReceipt.rendered(drawingKey(rendered));
    const timing = graphTiming.current;
    if (
      !timing ||
      timing.epoch !== graphEpoch.current ||
      timing.first ||
      !graphBuildRef.current?.commands.length
    )
      return;
    timing.first = true;
    performance.measure('math-audio:graph:first-visible', {
      start: timing.start,
      end: performance.now(),
    });
  };
  const showBuild = (value: Build | null) => {
    graphBuildRef.current = value;
    setGraphBuild(value);
  };
  const discardBuild = () => {
    graphEpoch.current++;
    graphBuilder.cancel();
    showBuild(null);
    setState(stateRef.current);
    if (bookRef.current && unsaved.current)
      persist({ ...bookRef.current, draft: inputRef.current });
  };
  useEffect(() => () => graphBuilder.cancel(), [graphBuilder]);
  const executeRef = useRef<
    (
      operation: CloudOperation,
      id?: string,
      fromVoice?: boolean,
      signal?: AbortSignal,
    ) => Promise<CloudResponse>
  >(async () => {
    throw new Error('Problems are loading.');
  });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef('');
  const resetProblemAudio = useRef(() => {});
  const acceptCloud = (
    snapshot: CloudSnapshot,
    replaceInput = true,
    showState = true,
  ) => {
    if (
      bookRef.current &&
      bookRef.current.problemId !== snapshot.book.problemId
    ) {
      resetProblemAudio.current();
      setResponse('');
      setError(false);
      setHelp(false);
    }
    liveRevision.current = snapshot.revision;
    bookRef.current = snapshot.book;
    setBook(snapshot.book);
    stateRef.current = currentProblem(snapshot.book).state;
    if (showState) setState(stateRef.current);
    setClarification(
      snapshot.clarification
        ? { ...snapshot.clarification, workspace: stateRef.current }
        : null,
    );
    if (replaceInput) {
      inputRef.current = snapshot.book.draft;
      setInput(snapshot.book.draft);
    }
    unsaved.current = false;
    if (showState) setSaveStatus('Saved');
  };
  const draftKey = useCallback(
    (problemId: string) =>
      `math-audio-unsent-draft:${owner ?? 'test'}:${problemId}`,
    [owner],
  );
  const keepDraft = useCallback(
    (text: string) => {
      inputRef.current = text;
      setInput(text);
      unsaved.current = true;
      setSaveStatus('Draft not saved yet');
      if (bookRef.current) {
        try {
          sessionStorage.setItem(draftKey(bookRef.current.problemId), text);
        } catch {
          /* Keep draft in memory. */
        }
      }
    },
    [draftKey],
  );
  useEffect(() => {
    let active = true;
    void cloud
      .load()
      .then((snapshot) => {
        if (!active) return;
        acceptCloud(snapshot);
        try {
          const draft = sessionStorage.getItem(
            draftKey(snapshot.book.problemId),
          );
          if (draft !== null && draft !== snapshot.book.draft) keepDraft(draft);
        } catch {
          /* Browser recovery storage may be unavailable. */
        }
      })
      .catch((error) => {
        if (active) setSaveStatus(error.message);
      });
    const protect = (event: BeforeUnloadEvent) => {
      if (unsaved.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', protect);
    return () => {
      active = false;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      window.removeEventListener('beforeunload', protect);
    };
  }, [cloud, draftKey, keepDraft]);
  const persist = (value: ProblemLibrary) => {
    cancelCelebration();
    keepDraft(value.draft);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (graphBuildRef.current) return;
    const problemId = value.problemId;
    draftTimer.current = setTimeout(() => {
      const text = inputRef.current;
      void cloud
        .apply({ kind: 'draft', text, problemId })
        .then((result) => {
          acceptCloud(result, false, !graphBuildRef.current);
          if (inputRef.current !== text) {
            unsaved.current = true;
            setSaveStatus('Draft not saved yet');
          } else {
            try {
              sessionStorage.removeItem(draftKey(problemId));
            } catch {
              /* Optional recovery storage. */
            }
          }
        })
        .catch((error) => {
          setSaveStatus(error.message);
        });
    }, 700);
  };
  const importBackup = async (file: File) => {
    if (file.size > 10_000_000) {
      notify('Choose a backup smaller than 10 MB.', true);
      return;
    }
    await executeRef.current({ kind: 'import', notebook: await file.text() });
  };
  const exportBook = (format: 'text' | 'json' | 'problem' = 'text') => {
    if (!bookRef.current) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          format === 'json'
            ? JSON.stringify(bookRef.current, null, 2)
            : format === 'problem'
              ? currentProblemText(bookRef.current)
              : problemLibraryText(bookRef.current),
        ],
        {
          type:
            format === 'json' ? 'application/json' : 'text/plain;charset=utf-8',
        },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `math-audio${format === 'problem' ? '-problem' : ''}.${format === 'json' ? 'json' : 'txt'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const activate = (value: ProblemLibrary) => {
    void executeRef
      .current({
        kind: 'select',
        assignmentId: value.assignmentId,
        problemId: value.problemId,
      })
      .catch(() => {});
  };
  const audio = useAudio(
    async (text: string, id: string, signal?: AbortSignal) => {
      const before = stateRef.current;
      const requestedDrawing = isGraphBuildRequest(text, before);
      const result = await executeRef.current(
        { kind: 'command', text, interpret: true },
        id,
        true,
        signal,
      );
      const after = currentProblem(result.book).state;
      const completedDrawing =
        result.status === 'command' &&
        after.mode === 'geometry' &&
        (requestedDrawing || drawingKey(before) !== drawingKey(after));
      if (completedDrawing)
        await drawingReceipt.wait(drawingKey(after), signal);
      return {
        status: result.status,
        result: result.message,
        saved: true,
        revision: result.revision,
        expression: currentProblem(result.book).state.expression,
      };
    },
    () => ({
      revision: String(liveRevision.current),
      owner,
      workspace: stateRef.current,
      history: bookRef.current ? historyContext(bookRef.current) : undefined,
      clarification: pendingClarification.current ?? undefined,
    }),
    (text) => {
      setResponse(text);
      setError(true);
      setNoticeVersion((v) => v + 1);
      void account?.refresh().catch(() => {});
    },
    spoken,
    (text) =>
      !pendingClarification.current &&
      !!directMathCommand(text, stateRef.current),
    recording,
  );
  useEffect(() => {
    resetProblemAudio.current = audio.reset;
  }, [audio.reset]);
  const { stop: stopAtLimit, stopListening: stopListeningAtLimit } = audio;
  const allowanceExhausted = account ? account.status.remainingMs <= 0 : false;
  useEffect(() => {
    if (allowanceExhausted) {
      stopAtLimit();
      stopListeningAtLimit();
    }
  }, [allowanceExhausted, stopListeningAtLimit, stopAtLimit]);
  const notify = (message: string, isError = false, _forceAudio = false) => {
    setResponse(message);
    setError(isError);
    setNoticeVersion((v) => v + 1);
  };
  const executeCloud = async (
    operation: CloudOperation,
    id = crypto.randomUUID(),
    fromVoice = false,
    signal?: AbortSignal,
  ): Promise<CloudResponse> => {
    recordingCompletion.current = null;
    const celebrationToken = cancelCelebration();
    journeyPoint(id, fromVoice ? 'voice-command' : 'submitted');
    const previousBuild = graphBuildRef.current;
    const epoch = ++graphEpoch.current;
    graphBuilder.cancel();
    // Spoken requests use the atomic command queue, allowing multiple delegations and mixed math/graphs.
    // The streamed visual preview has a single owner and is reserved for typed graph builds.
    const buildRequest =
      !fromVoice &&
      operation.kind === 'command' &&
      operation.interpret &&
      (isGraphBuildRequest(operation.text, stateRef.current) ||
        (pendingClarification.current &&
          isGraphClarificationAnswer(operation.text) &&
          isGraphBuildRequest(
            pendingClarification.current.request,
            stateRef.current,
          )) ||
        (previousBuild &&
          /\b(actually|instead|make that|correction)\b/i.test(operation.text)));
    if (buildRequest && operation.kind === 'command')
      showBuild({
        text: operation.text,
        commands: [],
        revision: cloud.snapshot?.revision ?? 0,
        phase: 'building',
        message: 'Building your graph…',
      });
    if (buildRequest)
      graphTiming.current = { epoch, start: performance.now(), first: false };
    const savingGraph = buildRequest || operation.kind === 'graph';
    setCommandProgress(
      operation.kind === 'command' &&
        operation.interpret &&
        !buildRequest &&
        (pendingClarification.current ||
          !directMathCommand(operation.text, stateRef.current))
        ? {
            phase:
              fromVoice && isGraphBuildRequest(operation.text, stateRef.current)
                ? 'graphing'
                : 'working',
          }
        : null,
    );
    if (operation.kind === 'graph' && previousBuild)
      showBuild({
        ...previousBuild,
        phase: 'saving',
        message: 'Saving your partial graph…',
      });
    if (!savingGraph) {
      showBuild(null);
      setState(stateRef.current);
    }
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    let beforeInput = inputRef.current;
    let beforeProblem = bookRef.current?.problemId;
    setSaveStatus('Saving to the shared test problem…');
    try {
      const waiting = performance.now();
      await cloud.settled();
      journeySpan(id, 'prior-save-wait', waiting);
      if (cloud.saveUnconfirmed) {
        setSaveStatus('Checking your previous save…');
        const recovered = await cloud.retry();
        if (recovered) {
          const changedProblem = recovered.book.problemId !== beforeProblem;
          acceptCloud(recovered, changedProblem, !buildRequest);
          if (changedProblem) {
            beforeInput = inputRef.current;
            beforeProblem = recovered.book.problemId;
          }
        }
      }
      if (buildRequest && epoch !== graphEpoch.current)
        throw new DOMException('Request replaced.', 'AbortError');
      if (
        bookRef.current &&
        cloud.snapshot &&
        beforeInput !== cloud.snapshot.book.draft &&
        !(operation.kind === 'graph' && previousBuild) &&
        operation.kind !== 'draft' &&
        operation.kind !== 'recovery'
      ) {
        await cloud.apply({
          kind: 'draft',
          text: beforeInput,
          problemId: bookRef.current.problemId,
        });
      }
      if (buildRequest && operation.kind === 'command') {
        const original = operation;
        const text =
          previousBuild &&
          /\b(actually|instead|change|make that|correction)\b/i.test(
            original.text,
          )
            ? `Previous request: ${previousBuild.text}\nStudent correction: ${original.text}`
            : original.text;
        const revision = cloud.snapshot!.revision;
        const initial = currentProblem(cloud.snapshot!.book).state;
        const build: Build = {
          text,
          commands: [],
          revision,
          phase: 'building',
          message: 'Building your graph…',
        };
        if (epoch !== graphEpoch.current)
          throw new DOMException('Graph replaced.', 'AbortError');
        showBuild(build);
        const ready = await graphBuilder.start(
          text,
          revision,
          (event) => {
            if (epoch !== graphEpoch.current) return;
            const preview = previewGraphCommands(initial, event.commands);
            journeyPoint(id, 'graph-preview');
            pendingDisplay.current = id;
            setState(preview.state);
            showBuild({
              ...build,
              commands: event.commands,
              message: 'Building your graph… Preview, not saved yet.',
            });
          },
          signal,
        );
        if (epoch !== graphEpoch.current)
          throw new DOMException('Graph replaced.', 'AbortError');
        operation = {
          kind: 'graph',
          commands: ready.commands,
          text: original.text,
          baseRevision: revision,
          consumeDraft: original.consumeDraft,
        };
        showBuild({
          ...graphBuildRef.current!,
          phase: 'saving',
          message: 'Saving your completed graph…',
        });
      }
      const result = await cloud.apply(
        operation,
        id,
        () => {
          signal?.throwIfAborted();
          if (buildRequest && epoch !== graphEpoch.current)
            throw new DOMException('Request replaced.', 'AbortError');
        },
        operation.kind === 'command' && operation.interpret
          ? (progress) => {
              if (epoch !== graphEpoch.current || signal?.aborted) return;
              setCommandProgress((previous) => ({
                ...previous,
                ...progress,
                workspace: progress.workspace ?? previous?.workspace,
                steps: progress.steps ?? previous?.steps,
              }));
              if (progress.workspace) {
                journeyPoint(id, 'command-preview');
                pendingPreview.current = id;
                setState(progress.workspace);
              }
            }
          : undefined,
      );
      journeyPoint(id, 'workspace-result');
      pendingDisplay.current = epoch === graphEpoch.current ? id : null;
      const inputUnchanged = inputRef.current === beforeInput;
      // Once sent, a confirmed save is durable. Older acknowledgements must not replace a new preview.
      acceptCloud(
        result,
        inputUnchanged && epoch === graphEpoch.current,
        epoch === graphEpoch.current,
      );
      if (buildRequest && graphTiming.current?.epoch === epoch)
        performance.measure('math-audio:graph:complete', {
          start: graphTiming.current.start,
          end: performance.now(),
        });
      if (epoch !== graphEpoch.current) return result;
      if (
        result.completion &&
        !signal?.aborted &&
        beforeProblem === result.book.problemId &&
        liveRevision.current === result.revision
      ) {
        const completion = result.completion;
        const celebrate = () => {
          if (
            liveRevision.current === result.revision &&
            bookRef.current?.problemId === completion.problemId
          )
            showVerified(completion, result.revision, celebrationToken);
        };
        if (recording) recordingCompletion.current = celebrate;
        else celebrate();
      }
      setCommandProgress(null);
      if (epoch === graphEpoch.current) showBuild(null);
      if (inputUnchanged && beforeProblem) {
        try {
          sessionStorage.removeItem(draftKey(beforeProblem));
        } catch {
          /* Optional recovery. */
        }
      } else {
        unsaved.current = true;
        setSaveStatus('Draft not saved yet');
        if (bookRef.current)
          persist({ ...bookRef.current, draft: inputRef.current });
      }
      if (result.panel)
        setPanels((p) => ({ ...p, [result.panel!.panel]: result.panel!.open }));
      setAIStatus(
        result.aiUnavailable
          ? 'AI unavailable · server commands active'
          : 'Cloud commands active',
      );
      notify(
        result.message,
        ['clarification', 'unsupported'].includes(result.status),
      );
      switch (result.action) {
        case 'export':
          exportBook();
          break;
        case 'print':
          if (bookRef.current)
            onPdfExport?.({ ...bookRef.current, draft: inputRef.current });
          break;
        case 'help':
          setHelp(true);
          break;
        case 'close-help':
          setHelp(false);
          break;
        case 'mute':
          setSpoken(false);
          audio.setReplies(false);
          break;
        case 'unmute':
          setSpoken(true);
          audio.setReplies(true);
          break;
        case 'stop':
        case 'listen-stop':
          audio.stopListening();
          break;
        case 'slower':
          setRate((r) => Math.max(0.5, r - 0.1));
          audio.setPace('slower');
          break;
        case 'faster':
          setRate((r) => Math.min(1.8, r + 0.1));
          audio.setPace('faster');
          break;
        case 'focus':
          field.current?.focus();
          break;
        case 'sonify': {
          const next = currentProblem(result.book).state;
          void audio.sonify(
            next.mode === 'statistics'
              ? next.data
              : curvePoints(
                  result.sonifyExpression || next.expression,
                  next.graphRange,
                ).map((p) => p.y),
          );
          break;
        }
      }
      if (!fromVoice && spoken && audio.microphoneActive && result.message)
        audio.reportFacts({
          status: result.status,
          result: result.message,
          saved: true,
        });
      return result;
    } catch (error) {
      if (epoch !== graphEpoch.current) throw error;
      setCommandProgress(null);
      if (!savingGraph) setState(stateRef.current);
      let failure = error;
      if (
        failure instanceof GraphBuildError &&
        failure.status === 'clarification' &&
        graphBuildRef.current
      ) {
        const build = graphBuildRef.current;
        try {
          const question = await cloud.apply(
            {
              kind: 'graph-question',
              text: build.text,
              question: failure.message,
              baseRevision: build.revision,
            },
            id,
            () => {
              signal?.throwIfAborted();
              if (epoch !== graphEpoch.current)
                throw new DOMException('Replaced.', 'AbortError');
            },
          );
          if (epoch === graphEpoch.current) {
            acceptCloud(question, false);
            showBuild(null);
            notify(question.message, true);
          }
          return question;
        } catch (saveError) {
          failure = saveError;
        }
      }
      const message =
        failure instanceof Error
          ? failure.message
          : 'Your cloud save is unconfirmed.';
      if (savingGraph && graphBuildRef.current)
        showBuild({
          ...graphBuildRef.current,
          phase: cloud.saveUnconfirmed ? 'save-unconfirmed' : 'failed',
          message: cloud.saveUnconfirmed
            ? 'The graph save could not be confirmed. It may already be saved. Retry the save to check.'
            : `Graph generation is not working. ${message} Your previous saved work is preserved.`,
        });
      if (!savingGraph || cloud.saveUnconfirmed) unsaved.current = true;
      setSaveStatus(
        cloud.saveUnconfirmed
          ? savingGraph
            ? 'Graph save unconfirmed'
            : 'Problem save unconfirmed. Try again to reconnect.'
          : savingGraph
            ? 'Graph preview not saved'
            : message,
      );
      notify(message, true);
      throw failure;
    }
  };
  const submit = (
    text: string,
    _forceAudio = false,
    fromVoice = false,
    fromComposer = false,
    _interpreted = false,
  ) => {
    if (!text.trim()) return;
    if (!bookRef.current) {
      notify('Wait for your cloud problem to load.', true);
      return;
    }
    void executeCloud(
      {
        kind: 'command',
        text,
        interpret: fromComposer || fromVoice,
        consumeDraft: fromComposer,
      },
      undefined,
      fromVoice,
    ).catch(() => {});
  };
  useEffect(() => {
    submitRef.current = submit;
    executeRef.current = executeCloud;
    notifyRef.current = notify;
  });
  const { stop, stopListening, toggleListening } = audio;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stop();
        stopListening();
        setHelp(false);
      }
      if (!e.repeat && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleListening();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [stop, stopListening, toggleListening]);
  const isBlank =
    state.mode === 'equation' &&
    state.expression === '0' &&
    (!book || currentProblem(book).steps.length === 0);
  const node = parseMath(state.expression),
    parts = partsFor(state),
    stat = statistics(state.data);
  const selected = Math.min(state.selection, parts.length - 1);
  const selectPart = (i: number) => {
    submit(
      stateRef.current.mode === 'statistics'
        ? `read point ${i + 1}`
        : `read part ${i + 1}`,
    );
  };
  const examples =
    state.mode === 'equation'
      ? [
          'x squared plus two x minus three equals zero',
          'Replace two x with four x',
          'Read the left side',
        ]
      : state.mode === 'statistics'
        ? [
            'Data 4, 5, 5, 6, 7, 8, 22',
            'Find the median',
            'Find outliers',
            'Sample standard deviation',
          ]
        : state.mode === 'geometry'
          ? [
              'Circle radius five',
              'Right triangle a three b four',
              'Set radius to seven',
            ]
          : [
              'Diagram start then measure then compare then finish',
              'Replace measure with read the sensor',
              'Next step',
            ];
  return {
    releaseRecordingCelebration: () => {
      recordingCompletion.current?.();
      recordingCompletion.current = null;
    },
    clarifying,
    celebration,
    celebrationsEnabled,
    setCelebrationsEnabled,
    cancelCelebration,
    state,
    input,
    setInput,
    spoken,
    rate,
    help,
    setHelp,
    response,
    error,
    noticeVersion,
    voiceAvailability,
    field,
    book,
    historyCount,
    panels,
    setPanels,
    aiStatus,
    importField,
    saveStatus,
    setSaveStatus,
    bookRef,
    cloud,
    graphBuild,
    commandProgress,
    graphBuildRef,
    graphRendered,
    showBuild,
    discardBuild,
    acceptCloud,
    persist,
    importBackup,
    exportBook,
    activate,
    audio,
    notify,
    executeCloud,
    submit,
    stop,
    stopListening,
    toggleListening,
    isBlank,
    node,
    parts,
    stat,
    selected,
    selectPart,
    examples,
  };
}
