'use client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  ArrowRight,
  Plus,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Upload,
  Play,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { playRecordingTake } from '../services/recording-take.ts';
import { PicoConfetti } from './pico-confetti.tsx';
import { AudioPanel, PersonIcon } from './audio-panel.tsx';
import { ProblemLibrarySection } from './problem-library.tsx';
import { GraphPanel } from './graph-panel.tsx';
import { EquationCarousel } from './equation-carousel.tsx';
import { CommandStatus } from './command-status.tsx';
import { displayNumber } from '../../math/index.ts';
import {
  currentProblem,
  type ProblemLibrary,
  selectProblem,
} from '../../problems/index.ts';
import {
  Chart,
  ExplorationView,
  GeometryView,
  GraphView,
} from '../../visuals/ui.ts';
import { useWorkspace } from '../hooks/use-workspace.ts';
import {
  AccountDetails,
  DeleteAccountControl,
  useAccount,
  SignInButton,
} from '../../accounts/ui.ts';

const helpCommands = [
  ['Problems', 'New problem / open problem 1'],
  ['Work', 'Subtract three from both sides / divide both sides by two'],
  [
    'Save a copy',
    'Export work / export PDF / read work. Import backup restores a downloaded JSON file.',
  ],
  ['Create', 'x squared plus two x minus three equals zero'],
  ['Correct', 'Replace two x with four x'],
  ['Explore', 'Read the left side'],
  ['Navigate', 'Next part / previous part / read part 3'],
  ['Calculate', 'Solve step by step'],
  [
    'Graph',
    'Graph y = x squared / range -5 to 5 / zoom in / find roots / evaluate at x 2 / table graph 1',
  ],
  ['Data', 'Data four, five, five, six, seven, eight, twenty two'],
  ['Statistics', 'Find outliers / read point 7 / play data'],
  [
    'Geometry',
    'Circle radius five / rectangle width six height four / right triangle a three b four / area / set radius to seven / double shape',
  ],
  ['Workspace', 'Equations / statistics / new session / undo'],
  [
    'Audio',
    'Turn responses on / turn responses off / slower / faster / read response / stop audio',
  ],
  ['Help', 'Help / close help / stop listening'],
];
export default function WorkspaceView({
  recording = false,
}: {
  recording?: boolean;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const pdfPending = useRef(false);
  const exportPdf = async (source: ProblemLibrary, problemId?: string) => {
    if (pdfPending.current) return;
    pdfPending.current = true;
    setPdfBusy(true);
    setPdfStatus('Preparing your PDF…');
    try {
      const snapshot = structuredClone(source);
      const { downloadProblemsPdf } = await import('./problem-pdf.tsx');
      await downloadProblemsPdf(snapshot, problemId);
      setPdfStatus('Your PDF is ready. Check your downloads.');
    } catch {
      setPdfStatus('Couldn’t create the PDF. Your work is safe. Try again.');
    } finally {
      pdfPending.current = false;
      setPdfBusy(false);
    }
  };
  const account = useAccount();
  const signedIn = Boolean(account && account.status.identity.kind !== 'guest');
  const {
    releaseRecordingCelebration,
    clarifying,
    celebration,
    celebrationsEnabled,
    setCelebrationsEnabled,
    cancelCelebration,
    state,
    input,
    spoken,
    help,
    setHelp,
    response,
    error,
    noticeVersion,
    voiceAvailability,
    book,
    historyCount,
    panels,
    setPanels,
    importField,
    saveStatus,
    setSaveStatus,
    cloud,
    graphBuild,
    commandProgress,
    graphBuildRef,
    graphRendered,
    showBuild,
    discardBuild,
    acceptCloud,
    importBackup,
    exportBook,
    activate,
    audio,
    notify,
    executeCloud,
    submit,
    isBlank,
    parts,
    stat,
    selected,
    selectPart,
    examples,
  } = useWorkspace(recording, (source) => {
    void exportPdf(source, source.problemId);
  });
  const [take, setTake] = useState({
    active: false,
    caption: '',
    reply: '',
    status: 'Ready',
    hidden: false,
  });
  const [takeMode, setTakeMode] = useState<'auto' | 'guided'>('auto');
  const [guidedCue, setGuidedCue] = useState<{
    line: string;
    step: number;
    status: string;
  } | null>(null);
  const [showGuidedCue, setShowGuidedCue] = useState(true);
  const takeController = useRef<AbortController | null>(null);
  const [takeTimings, setTakeTimings] = useState<
    { text: string; processingMs: number }[]
  >([]);
  useEffect(() => () => takeController.current?.abort(), []);
  // Escape always brings the local recording controls back into view.
  useEffect(() => {
    if (!recording) return;
    const showControls = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        takeController.current?.abort();
        setTake((value) => ({ ...value, active: false, hidden: false }));
      }
    };
    window.addEventListener('keydown', showControls);
    return () => window.removeEventListener('keydown', showControls);
  }, [recording]);
  /** Starts a fresh synthetic problem and sends each authored transcript through the normal voice-command queue. */
  const startTake = async (mode: 'auto' | 'guided' = 'auto') => {
    if (takeController.current || !book) return;
    const controller = new AbortController();
    takeController.current = controller;
    setTakeMode(mode);
    setGuidedCue(null);
    setShowGuidedCue(true);
    audio.stopListening();
    audio.stop();
    audio.setReplies(true);
    setTakeTimings([]);
    setTake({
      active: false,
      caption: '',
      reply: '',
      status: 'Preparing…',
      hidden: true,
    });
    try {
      await executeCloud({ kind: 'new', title: 'Recording take' });
      controller.signal.throwIfAborted();
      audio.beginRecordingReplies();
      await audio.sayRecordingFacts(
        {
          status: 'ready',
          saved: false,
          result:
            'The student will dictate their own steps. Briefly say okay; wait for saved results before confirming any math.',
        },
        controller.signal,
      );
      setTake((value) => ({ ...value, active: true, status: 'Recording' }));
      await playRecordingTake(
        [
          {
            text: 'I’ll graph y equals x squared plus five x plus two.',
            wordMs: 240,
            holdMs: 300,
          },
          {
            text: 'Now change five x to three x.',
            wordMs: 240,
            holdMs: 300,
          },
          {
            text: 'Zoom in.',
            wordMs: 240,
            holdMs: 500,
          },
          {
            text: 'Write open parenthesis x plus two close parenthesis times open parenthesis x plus one close parenthesis equals zero.',
            wordMs: 240,
            holdMs: 500,
          },
          {
            text: 'Write x equals negative two and x equals negative one.',
            wordMs: 240,
            holdMs: 2800,
          },
        ],
        (caption) => {
          audio.clearRecordingReply();
          setTake((value) => ({ ...value, caption, reply: '' }));
        },
        async (text) => {
          const started = performance.now();
          const result = await executeCloud(
            { kind: 'command', text, interpret: true },
            undefined,
            true,
            controller.signal,
          );
          if (
            recording &&
            text === 'Zoom in.' &&
            result.status === 'command' &&
            !result.aiUnavailable
          ) {
            // A closer recording view keeps the vertex clear of the editor edge.
            await executeCloud(
              { kind: 'command', text: 'view x -5 to 3 y -5 to 3' },
              undefined,
              true,
              controller.signal,
            );
          }
          controller.signal.throwIfAborted();
          setTakeTimings((values) => [
            ...values,
            { text, processingMs: performance.now() - started },
          ]);
          setTake((value) => ({ ...value, reply: '' }));
          if (result.status !== 'command' || result.aiUnavailable)
            throw new Error(
              result.message || 'The app could not complete this command.',
            );
          const replyText = result.completion
            ? 'Looks like you solved it!'
            : text === 'Zoom in.'
              ? 'Got it.'
              : text.startsWith('Now change')
                ? 'Yup.'
                : text.startsWith('Write')
                  ? 'Okay.'
                  : 'Got it.';
          const spokenReply = await audio.sayRecordingFacts(
            {
              status: result.status,
              saved: true,
              revision: result.revision,
              result: `${result.completion ? `Verified complete answer: ${result.completion.answer}.` : result.message} For this reply, say exactly: "${replyText}" Use a warm, relaxed tone${result.completion ? ', with cheerful upward inflection' : ''}. Do not add any other words.`,
            },
            controller.signal,
            result.completion ? replyText : undefined,
          );
          setTake((value) => ({ ...value, reply: spokenReply }));
          if (result.completion) {
            releaseRecordingCelebration();
            audio.playRecordingWin();
          }
        },
        controller.signal,
        mode === 'guided'
          ? async (line, index) => {
              setGuidedCue({
                line: line.text,
                step: index + 1,
                status: 'Opening microphone…',
              });
              audio.clearRecordingReply();
              setTake((value) => ({ ...value, caption: '', reply: '' }));
              await audio.listenRecordingLine(
                controller.signal,
                (caption) => setTake((value) => ({ ...value, caption })),
                (status) =>
                  setGuidedCue((value) =>
                    value ? { ...value, status } : null,
                  ),
              );
              setGuidedCue((value) =>
                value
                  ? { ...value, status: 'Applying this preset step…' }
                  : null,
              );
            }
          : undefined,
      );
      setTake((value) => ({ ...value, status: 'Finished' }));
    } catch (error) {
      setTake((value) => ({
        ...value,
        active: false,
        hidden: false,
        status: controller.signal.aborted
          ? 'Stopped'
          : error instanceof Error
            ? error.message
            : 'Recording failed',
      }));
    } finally {
      setGuidedCue(null);
      await audio.finishRecordingReplies();
      takeController.current = null;
    }
  };
  const [focus, setFocus] = useState<{ key: string; index: number } | null>(
    null,
  );
  const [creatingProblem, setCreatingProblem] = useState(false);
  const savedProblem = book ? currentProblem(book) : null;
  const problem =
    savedProblem && commandProgress?.steps
      ? { ...savedProblem, steps: commandProgress.steps, state }
      : savedProblem;
  const focusKey = `${problem?.id}:${problem?.steps.at(-1)?.at}:${problem?.steps.length}`;
  const focusedIndex =
    focus?.key === focusKey ? focus.index : (problem?.steps.length ?? 1) - 1;
  const reviewed =
    focusedIndex < (problem?.steps.length ?? 0) - 1
      ? problem?.steps[focusedIndex]?.state
      : null;
  const reviewingGraph = Boolean(reviewed?.graph);
  const graphSource = reviewingGraph ? reviewed! : state;
  const graphState = graphSource.retainedGraph
    ? { ...graphSource, graphScene: graphSource.retainedGraph }
    : graphSource;
  const screen =
    signedIn && (panels.settings || panels.library) ? 'settings' : 'work';
  const routineSave =
    /^(Saved|Saving|Loading|Checking your previous save)/.test(saveStatus);
  const focusHeading = () =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.page-heading h1')?.focus(),
    );
  const openScreen = (screen: 'work' | 'settings' | 'problems') => {
    cancelCelebration();
    setPanels((p) => ({
      ...p,
      settings: screen !== 'work',
      library: false,
    }));
    focusHeading();
  };
  const emptyProblem = isBlank && !problem?.exploration;
  const picoWorking =
    !!commandProgress ||
    graphBuild?.phase === 'building' ||
    graphBuild?.phase === 'saving';
  const equationGeometry =
    state.mode === 'equation' &&
    !graphState.graph &&
    Boolean(state.geometry || state.construction);
  const geometryPreview =
    state.geometry || state.construction ? (
      <fieldset
        disabled={!!graphBuild || !!commandProgress}
        className="graph-preview-controls"
        data-preview={!!graphBuild}
      >
        <GeometryView
          controls={false}
          onRendered={() => graphRendered(state)}
          geometry={state.geometry}
          construction={state.construction}
          overlay={state.geometryOverlay}
          canUndo={!!historyCount}
          onCommand={(command) =>
            submit(command, command === 'describe shape', false, false, true)
          }
        />
      </fieldset>
    ) : null;
  const requestProgress = (
    <>
      {commandProgress && <CommandStatus progress={commandProgress} />}

      {graphBuild && (
        <span
          className="pico-build-progress"
          data-failed={
            graphBuild.phase === 'failed' ||
            graphBuild.phase === 'save-unconfirmed'
          }
          role={
            graphBuild.phase === 'failed' ||
            graphBuild.phase === 'save-unconfirmed'
              ? 'alert'
              : 'status'
          }
        >
          <em>
            {graphBuild.phase === 'building'
              ? 'Graphing…'
              : graphBuild.phase === 'saving'
                ? 'Saving…'
                : graphBuild.message}
          </em>
          {graphBuild.phase === 'save-unconfirmed' && (
            <button
              className="soft-button"
              onClick={() => {
                void cloud
                  .retry()
                  .then((result) => {
                    if (result) {
                      acceptCloud(result, false);
                      showBuild(null);
                      notify('Graph save confirmed.');
                    }
                  })
                  .catch((error) => notify(error.message, true));
              }}
            >
              Retry graph save
            </button>
          )}
          {graphBuild.phase === 'failed' && (
            <>
              <button
                className="soft-button"
                onClick={() => submit(graphBuild.text, false, false, true)}
              >
                Retry
              </button>
              {!!graphBuild.commands.length && (
                <button
                  className="soft-button"
                  onClick={() => {
                    void executeCloud({
                      kind: 'graph',
                      commands: graphBuild.commands,
                      text: graphBuild.text,
                      baseRevision: graphBuild.revision,
                    }).catch(() => {});
                  }}
                >
                  Keep valid partial graph
                </button>
              )}
            </>
          )}
          {graphBuild.phase !== 'saving' &&
            graphBuild.phase !== 'save-unconfirmed' && (
              <button className="soft-button" onClick={discardBuild}>
                {graphBuild.phase === 'building'
                  ? 'Cancel build'
                  : 'Discard preview'}
              </button>
            )}
        </span>
      )}
    </>
  );
  const audioPanel = (
    <>
      <AudioPanel
        scripted={recording}
        active={recording ? take.active : audio.microphoneActive}
        starting={audio.starting}
        speaking={audio.speaking}
        working={picoWorking}
        celebrating={
          celebration?.active && celebration.problemId === problem?.id
        }
        success={
          celebration && celebration.problemId === problem?.id
            ? `Solution verified. ${celebration.answer}.`
            : undefined
        }
        attention={
          picoWorking
            ? 'neutral'
            : clarifying
              ? 'clarifying'
              : error
                ? 'unavailable'
                : 'neutral'
        }
        partial={recording ? take.caption : audio.partial}
        reply={
          recording ? audio.reply || take.reply : error ? response : audio.reply
        }
        waveform={audio.waveform}
        progress={requestProgress}
        status={
          voiceAvailability === 'unconfigured'
            ? 'Voice is not configured yet.'
            : audio.connectionState
        }
        onToggle={() => {
          if (recording) {
            takeController.current?.abort();
            return;
          }
          if (voiceAvailability === 'unconfigured')
            notify(
              'Voice is not set up yet. Your saved problems are available in Settings.',
              true,
            );
          else audio.toggleListening();
        }}
      />
    </>
  );
  return (
    <div
      className="app-shell"
      data-recording={recording ? 'true' : undefined}
      data-recording-status={recording ? take.status : undefined}
      data-screen={screen}
      data-ready={book ? 'true' : 'false'}
      data-empty={screen === 'work' && emptyProblem ? 'true' : undefined}
      data-drawing={
        screen === 'work' &&
        !isBlank &&
        (state.mode === 'geometry' || state.mode === 'statistics')
          ? state.mode
          : undefined
      }
      data-graph={
        screen === 'work' &&
        state.mode === 'equation' &&
        !isBlank &&
        (graphState.graph || equationGeometry)
          ? 'true'
          : undefined
      }
    >
      {recording && (
        <aside
          aria-label="Recording controls"
          hidden={take.hidden}
          style={{
            position: 'fixed',
            zIndex: 1000,
            bottom: 24,
            right: 24,
            maxWidth: 420,
            padding: 20,
            background: 'white',
            boxShadow: '0 6px 24px #0002',
            borderRadius: 12,
          }}
        >
          <h2>Record this take</h2>
          <p>
            Start take uses scripted input. Start guided take uses your
            microphone. Both keep real app commands and spoken replies.
          </p>
          <button
            className="soft-button"
            disabled={!book || take.active}
            onClick={() => void startTake()}
          >
            Start take
          </button>
          <button
            className="soft-button"
            disabled={!book || take.active}
            onClick={() => void startTake('guided')}
          >
            Start guided take
          </button>
          <p>
            Guided take: preset actions, live microphone transcript. Wait for
            the app’s reply before the next line.
          </p>
          <button
            className="soft-button"
            onClick={() => setTake((value) => ({ ...value, hidden: true }))}
          >
            Hide controls
          </button>
          <output>{take.status}</output>
          {audio.recordedReplies && (
            <a
              href={audio.recordedReplies.url}
              download="Mathwave-App-Replies.webm"
              data-started-at={audio.recordedReplies.startedAt}
            >
              {takeMode === 'guided'
                ? 'Download take audio'
                : 'Download app replies'}
            </a>
          )}
          <p>Escape stops the take and shows these controls.</p>
          <output aria-label="Measured command timings">
            {takeTimings.map((timing) => (
              <p key={timing.text}>
                {timing.text}: {(timing.processingMs / 1000).toFixed(2)} s
              </p>
            ))}
          </output>
        </aside>
      )}
      {recording &&
        takeMode === 'guided' &&
        guidedCue &&
        showGuidedCue &&
        take.active && (
          <aside
            className="recording-guided-cue"
            aria-label="Guided recording cue"
          >
            <h2>Say this next ({guidedCue.step} of 5)</h2>
            <p>{guidedCue.line}</p>
            <output aria-live="polite">{guidedCue.status}</output>
            <button
              className="soft-button"
              onClick={() => setShowGuidedCue(false)}
            >
              Hide cue
            </button>
            <small>
              Pause about two seconds when finished. Escape stops the take.
            </small>
          </aside>
        )}
      {screen === 'work' && (
        <output className="sr-only" aria-live="polite">
          {pdfStatus}
        </output>
      )}
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <div className="main-shell">
        {screen === 'work' &&
          celebration?.active &&
          celebration.problemId === problem?.id && (
            <PicoConfetti
              key={`${celebration.problemId}:${celebration.revision}`}
            />
          )}
        {screen === 'work' && (
          <header className="topbar focus-topbar">
            {signedIn ? (
              <button
                className="account-button"
                aria-label="Your problems and account"
                onClick={() => openScreen('settings')}
              >
                <PersonIcon />
              </button>
            ) : (
              <SignInButton />
            )}
            <div className="topbar-controls">{!emptyProblem && audioPanel}</div>
          </header>
        )}
        <main id="workspace" tabIndex={-1}>
          <div className="page-heading">
            <h1
              tabIndex={-1}
              className={screen === 'work' ? 'sr-only' : undefined}
            >
              {screen === 'settings'
                ? 'Settings'
                : problem?.title || 'Your math problem'}
            </h1>
            {screen === 'settings' && (
              <nav
                className="settings-navigation"
                aria-label="Problem navigation"
              >
                <button
                  className="back-to-solving"
                  disabled={!book || creatingProblem}
                  onClick={() => openScreen('work')}
                >
                  Back to latest problem{' '}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
                <button
                  className="back-to-solving"
                  disabled={!book || creatingProblem}
                  onClick={async () => {
                    setCreatingProblem(true);
                    try {
                      await executeCloud({ kind: 'new' });
                      openScreen('work');
                    } catch {
                      // The save error and retry controls stay visible in Settings.
                    } finally {
                      setCreatingProblem(false);
                    }
                  }}
                >
                  {creatingProblem ? 'Starting new problem…' : 'New problem'}
                  <Plus size={18} aria-hidden="true" />
                </button>
              </nav>
            )}
            <p
              className={`focus-save ${routineSave ? 'sr-only' : ''}`}
              role={routineSave ? 'status' : 'alert'}
              aria-live={routineSave ? 'off' : 'polite'}
            >
              {saveStatus}
            </p>
          </div>
          <div className="work-grid">
            <section aria-label="Math workspace" className="workspace-content">
              <div
                className="context-actions"
                aria-label="Work with this problem"
              >
                {(!isBlank
                  ? state.mode === 'equation'
                    ? []
                    : state.mode === 'statistics'
                      ? ['Median', 'Mean', 'Find outliers']
                      : state.mode === 'geometry'
                        ? []
                        : []
                  : []
                ).map((command) => (
                  <button
                    className="soft-button"
                    key={command}
                    disabled={command === 'Undo' && !historyCount}
                    onClick={() => submit(command)}
                  >
                    {command}
                  </button>
                ))}
              </div>

              {emptyProblem && (
                <div className="empty-problem">
                  <h2 className="empty-problem-title">
                    What math shall we play with today?
                  </h2>
                  {audioPanel}
                  <ul
                    className="voice-examples"
                    aria-label="Example voice commands"
                  >
                    <li>“Draw a triangle with sides 3, 4, and 5.”</li>
                    <li>“Graph y equals x squared.”</li>
                    <li>“Write 2x plus 3 equals 11.”</li>
                  </ul>
                </div>
              )}
              {state.mode === 'equation' && !isBlank && (
                <div className="problem-canvas" aria-label="Current equation">
                  <div className="equation-column">
                    {problem && problem.steps.length > 0 && (
                      <EquationCarousel
                        key={problem.id}
                        problem={problem}
                        focused={focusedIndex}
                        onFocus={(index) => setFocus({ key: focusKey, index })}
                        busy={
                          saveStatus.startsWith('Saving') ||
                          !!graphBuild ||
                          !!commandProgress
                        }
                        onRevise={async (step, expression) => {
                          await executeCloud({
                            kind: 'revise-step',
                            step,
                            expression,
                          });
                        }}
                        onBranch={async (index) => {
                          await executeCloud({ kind: 'branch', index });
                        }}
                      />
                    )}
                  </div>
                  {(graphState.graph || equationGeometry) && (
                    <GraphPanel key={problem?.id}>
                      {equationGeometry ? (
                        geometryPreview
                      ) : (
                        <fieldset
                          disabled={
                            !!graphBuild || !!commandProgress || reviewingGraph
                          }
                          className="graph-preview-controls"
                          data-preview={!!graphBuild}
                        >
                          <GraphView
                            recordingMotion={recording}
                            onRendered={() => graphRendered(state)}
                            interactive={
                              !graphBuild && !commandProgress && !reviewed
                            }
                            expression={graphState.expression}
                            range={graphState.graphRange}
                            yRange={graphState.graphYRange}
                            expressions={graphState.graphExpressions}
                            scene={graphState.graphScene}
                            trace={graphState.graphTrace}
                            comparisonPoints={graphState.graphComparison}
                            onCommand={(command) =>
                              submit(
                                command,
                                command.startsWith('evaluate'),
                                false,
                                false,
                                true,
                              )
                            }
                          />
                        </fieldset>
                      )}
                    </GraphPanel>
                  )}
                </div>
              )}
              {state.mode === 'statistics' && (
                <div className="problem-canvas" aria-label="Current statistics">
                  <div className="math-card">
                    <details
                      className="inline-panel extra-calculations"
                      open={panels.calculations}
                      onToggle={(e) => {
                        const open = e.currentTarget.open;
                        setPanels((p) => ({ ...p, calculations: open }));
                      }}
                    >
                      <summary>More calculations</summary>
                      <div
                        className="equation-actions"
                        aria-label="Statistics calculations"
                      >
                        {[
                          'Mode',
                          'Range',
                          'Sum',
                          'Count',
                          'Sample standard deviation',
                          'Population standard deviation',
                        ].map((command) => (
                          <button
                            key={command}
                            className="soft-button"
                            onClick={() => submit(command)}
                          >
                            {command}
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
                      values={state.data}
                      labels={[
                        'Observation 1',
                        `Observation ${state.data.length}`,
                      ]}
                      selected={selected}
                      onSelect={selectPart}
                    />
                    <div className="data-values">
                      <strong>Data</strong>{' '}
                      {state.data.map(displayNumber).join(', ')}
                    </div>
                    <div className="equation-actions">
                      <button
                        className="soft-button"
                        onClick={() => submit('read data', true)}
                      >
                        <Volume2 size={17} />
                        Describe data
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => submit('play data')}
                      >
                        <Play size={16} />
                        Play data
                      </button>
                    </div>
                    <div className="parts-section">
                      <p className="stats-note">
                        Potential outliers use the 1.5 × IQR rule. A flag is a
                        prompt to investigate, not a reason to remove a value.
                      </p>
                      <div className="part-navigation">
                        <button
                          onClick={() => submit('previous point', true)}
                          disabled={selected <= 0}
                          aria-label="Previous point"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span>
                          Observation {selected + 1}:{' '}
                          {displayNumber(state.data[selected] ?? 0)}
                        </span>
                        <button
                          onClick={() => submit('next point', true)}
                          disabled={selected >= parts.length - 1}
                          aria-label="Next point"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {state.mode === 'geometry' && geometryPreview}
              {audio.failure && (
                <p className="voice-failure" role="alert">
                  {audio.failure}
                </p>
              )}
              {book && currentProblem(book).exploration && (
                <ExplorationView
                  lesson={currentProblem(book).exploration!}
                  onChange={(name, value) => {
                    try {
                      void executeCloud({
                        kind: 'exploration',
                        name,
                        value,
                      }).catch(() => {});
                    } catch (error) {
                      notify(
                        error instanceof Error
                          ? error.message
                          : 'Could not change this control.',
                        true,
                      );
                    }
                  }}
                  onSpeak={(text) => audio.reportFacts({ readback: text })}
                  onDismiss={() => {
                    void executeCloud({ kind: 'dismiss-exploration' }).catch(
                      () => {},
                    );
                    focusHeading();
                  }}
                />
              )}
              {book && currentProblem(book).recovery && (
                <div className="recovery-transcript">
                  <p>Unrecognized speech: {currentProblem(book).recovery}</p>
                  <p>Try saying it again.</p>
                </div>
              )}
              <output
                className="sr-only"
                aria-live={spoken ? 'off' : 'polite'}
                aria-atomic="true"
              >
                <span key={noticeVersion}>{response}</span>
              </output>
            </section>
            {screen === 'settings' && (
              <section className="settings-page" aria-label="Settings">
                <p>Manage your problems, audio, and information.</p>
                <div className="settings-columns">
                  <ProblemLibrarySection
                    book={book}
                    exporting={pdfBusy}
                    onExport={(problemId) => {
                      if (book)
                        void exportPdf({ ...book, draft: input }, problemId);
                    }}
                    onDelete={async (assignmentId, problemId) => {
                      audio.stopListening();
                      audio.stop();
                      await executeCloud({
                        kind: 'delete',
                        assignmentId,
                        problemId,
                      });
                    }}
                    onOpen={(assignmentId, problemId) => {
                      if (book)
                        activate(selectProblem(book, assignmentId, problemId));
                      openScreen('work');
                    }}
                  />
                  <div className="settings-secondary">
                    <section className="settings-section settings-account">
                      <h2>Account</h2>
                      <AccountDetails
                        beforeChange={() => {
                          audio.stopListening();
                          audio.stop();
                        }}
                      />
                    </section>

                    <section
                      className="settings-section settings-audio"
                      aria-labelledby="audio-settings-heading"
                    >
                      <h2 id="audio-settings-heading">Audio</h2>
                      <div className="preference-row">
                        <div>
                          <label htmlFor="spoken-responses">
                            Spoken responses
                          </label>
                        </div>
                        <Switch
                          id="spoken-responses"
                          checked={spoken}
                          onCheckedChange={(v) =>
                            submit(
                              v ? 'turn responses on' : 'turn responses off',
                            )
                          }
                        />
                      </div>
                    </section>
                    <section
                      className="settings-section settings-celebrations"
                      aria-labelledby="celebrations-heading"
                    >
                      <h2 id="celebrations-heading">Celebrations</h2>
                      <div className="preference-row">
                        <div>
                          <label htmlFor="pico-celebrations">
                            Confetti celebrations
                          </label>
                        </div>
                        <Switch
                          id="pico-celebrations"
                          checked={celebrationsEnabled}
                          onCheckedChange={setCelebrationsEnabled}
                        />
                      </div>
                    </section>
                    <section
                      className="settings-section settings-data"
                      aria-labelledby="data-settings-heading"
                    >
                      <h2 id="data-settings-heading">Your data</h2>
                      <div className="data-action-row">
                        <div>
                          <h3>Export your work</h3>
                          <p>
                            Share one problem or all your work as a PDF, with
                            equations, diagrams, and graphs.
                          </p>
                        </div>
                        <div className="data-actions">
                          <button
                            className="soft-button"
                            disabled={!book}
                            onClick={() => exportBook()}
                          >
                            <FileText size={18} aria-hidden="true" />
                            Download text
                          </button>
                          <button
                            className="soft-button"
                            disabled={!book || pdfBusy}
                            aria-busy={pdfBusy}
                            onClick={() => {
                              if (book)
                                void exportPdf(
                                  { ...book, draft: input },
                                  book.problemId,
                                );
                            }}
                          >
                            <Download size={18} aria-hidden="true" />
                            Current problem PDF
                          </button>
                          <button
                            className="soft-button"
                            disabled={!book || pdfBusy}
                            aria-busy={pdfBusy}
                            onClick={() => {
                              if (book)
                                void exportPdf({ ...book, draft: input });
                            }}
                          >
                            <Download size={18} aria-hidden="true" />
                            All problems PDF
                          </button>
                        </div>
                      </div>
                      <output aria-live="polite">{pdfStatus}</output>
                      <div className="data-action-row">
                        <div>
                          <h3>Back up your problems</h3>
                          <p>
                            Keep a file you can import later. Importing adds
                            problems without replacing your current work.
                          </p>
                        </div>
                        <div className="data-actions">
                          <button
                            className="soft-button"
                            disabled={!book}
                            onClick={() => exportBook('json')}
                          >
                            <Download size={18} aria-hidden="true" />
                            Download backup
                          </button>
                          <button
                            className="soft-button"
                            onClick={() => importField.current?.click()}
                          >
                            <Upload size={18} aria-hidden="true" />
                            Import backup
                          </button>
                          <input
                            ref={importField}
                            type="file"
                            accept=".json,application/json"
                            aria-label="Import problem backup"
                            hidden
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) void importBackup(file);
                            }}
                          />
                        </div>
                      </div>
                      {(!routineSave || cloud.saveUnconfirmed) && (
                        <div className="settings-save-recovery">
                          <button
                            className="soft-button"
                            type="button"
                            onClick={() => {
                              void cloud
                                .retry()
                                .then((result) => {
                                  if (result) {
                                    acceptCloud(result);
                                    if (
                                      graphBuildRef.current?.phase ===
                                      'save-unconfirmed'
                                    )
                                      showBuild(null);
                                  }
                                })
                                .catch((error) => setSaveStatus(error.message));
                            }}
                          >
                            Retry saving
                          </button>
                        </div>
                      )}
                    </section>
                    <section className="settings-section settings-delete">
                      <div>
                        <h2>Delete account</h2>
                        <DeleteAccountControl
                          beforeChange={() => {
                            audio.stopListening();
                            audio.stop();
                          }}
                        />
                      </div>
                    </section>
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="voice-dialog" showCloseButton={false}>
          <DialogTitle>Commands & shortcuts</DialogTitle>
          <DialogDescription>
            Say these commands. Start the microphone once, then speak naturally
            within these patterns. On a touch device, use your screen reader or
            system Voice Control to activate Start listening.
          </DialogDescription>
          <div className="help-examples">
            {examples.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
          <p>
            Open settings with “open voice settings” or “show saved problems”.
          </p>
          <div className="help-table">
            {helpCommands.map(([label, example]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>{example}</span>
              </div>
            ))}
          </div>
          <p className="help-note">
            Fractions need clear groups: “open parenthesis x plus one close
            parenthesis over two.” Functions need parentheses. Trig uses
            radians; log is base 10. Solving supports polynomial equations up to
            degree two in x. Speech pauses listening during playback to avoid
            hearing itself; press Escape to interrupt. Higher graph pitches
            represent larger values within the current view.
          </p>
          <button
            className="primary-button"
            onClick={() => submit('close help')}
          >
            Close help
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
