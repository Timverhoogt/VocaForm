import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject
} from "react";
import logoUrl from "../../public/assets/vocaform-mark.svg";
import type {
  MemorySuggestion,
  RememberableAnswer
} from "../domain/memory";
import type {
  AnswerValue,
  FormField,
  MemoryClaim,
  VerificationAction,
  VerificationIssue
} from "../domain/schemas";
import type {
  CompilationResult,
  FixtureSummary,
  HealthPayload,
  MemoryMutationResponse,
  MemoryVaultView,
  SessionView
} from "../shared/api";
import { downloadDraft, downloadVerified, requestJson } from "./api";
import { ChoiceQuestionModal } from "./ChoiceQuestionModal";
import type { RealtimeInterviewState } from "./realtime";
import { useRealtimeInterview } from "./use_realtime_interview";

type Stage = "upload" | "talk" | "review" | "download";
type DownloadComplete = "draft" | "final" | null;

const stageLabels: Record<Stage, string> = {
  upload: "Upload",
  talk: "Talk",
  review: "Review",
  download: "Download"
};

interface ActionOptions {
  pendingMessage: string;
  renderingDownload?: Exclude<DownloadComplete, null>;
  retryLabel?: string;
}

interface RecoveryAction {
  label: string;
  run: () => void | Promise<void>;
}

export function App() {
  const memoryButtonRef = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [stageFocusRequest, setStageFocusRequest] = useState(0);
  const stageFocusStateRef = useRef<{ stage: Stage; request: number }>({ stage: "upload", request: 0 });
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [view, setView] = useState<SessionView | null>(null);
  const [compilation, setCompilation] = useState<CompilationResult | null>(null);
  const [memory, setMemory] = useState<MemoryVaultView | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("Preparing VocaForm…");
  const [notice, setNotice] = useState("Preparing VocaForm…");
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryAction | null>(null);
  const [downloadComplete, setDownloadComplete] = useState<DownloadComplete>(null);
  const [downloadRendering, setDownloadRendering] = useState<DownloadComplete>(null);
  const realtime = useRealtimeInterview({
    enabled: stage === "talk" && Boolean(view) && Boolean(health?.openai.configured),
    sessionVersion: view?.session.version ?? 0,
    onSessionView: setView
  });

  useEffect(() => {
    async function initialize() {
      try {
        const [healthPayload, fixturePayload, memoryPayload] = await Promise.all([
          requestJson<HealthPayload>("/api/health"),
          requestJson<{ fixtures: FixtureSummary[] }>("/api/fixtures"),
          requestJson<MemoryVaultView>("/api/memory")
        ]);
        setHealth(healthPayload);
        setFixtures(fixturePayload.fixtures);
        setMemory(memoryPayload);

        try {
          setView(await requestJson<SessionView>("/api/session"));
          setNotice("Your form is ready.");
        } catch {
          try {
            const existingCompilation = await requestJson<CompilationResult>("/api/compilation");
            setCompilation(existingCompilation);
            setNotice(existingCompilation.readiness.ready
              ? "Your form is understood and ready."
              : "Your form needs a quick readiness check.");
          } catch {
            setNotice("Choose a form to begin.");
          }
        }
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Something went wrong.";
        setError(message);
        setRecovery({
          label: "Reload VocaForm",
          run: () => window.location.reload()
        });
      }
    }

    void initialize();
  }, []);

  useEffect(() => {
    const previous = stageFocusStateRef.current;
    if (previous.stage === stage && previous.request === stageFocusRequest) {
      return;
    }
    stageFocusStateRef.current = { stage, request: stageFocusRequest };
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-stage-heading]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stage, stageFocusRequest]);

  const currentSection = useMemo(() => {
    if (!view?.nextField) return null;
    return view.session.form.sections.find((section) =>
      section.fields.some((field) => field.id === view.nextField?.id)
    ) ?? null;
  }, [view]);

  async function openFixture(fixtureId: string) {
    await runAction(async () => {
      const session = await requestJson<SessionView>("/api/session/fixture", {
        method: "POST",
        body: JSON.stringify({ fixtureId })
      });
      setView(session);
      setCompilation(null);
      setStage("upload");
      setDownloadComplete(null);
      requestStageFocus();
      setNotice("VocaForm found the questions and prepared the conversation.");
    }, {
      pendingMessage: "Opening and checking the reviewed form…",
      retryLabel: "Try opening the form again"
    });
  }

  async function compileFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      showError(new Error("Choose a file smaller than 10 MB."));
      return;
    }
    await runAction(async () => {
      const result = await requestJson<CompilationResult>("/api/forms/compile", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          dataBase64: arrayBufferToBase64(await file.arrayBuffer())
        })
      });
      setView(null);
      setCompilation(result);
      setStage("upload");
      setDownloadComplete(null);
      requestStageFocus();
      setNotice(result.readiness.ready
        ? "The form is grounded and ready for a conversation."
        : "The form was read, but a few findings need attention.");
    }, {
      pendingMessage: "Reading your form and checking every question…",
      retryLabel: "Try reading the form again"
    });
  }

  async function startCompiledForm() {
    if (!compilation) return;
    await runAction(async () => {
      const session = await requestJson<SessionView>("/api/session/compiled", {
        method: "POST",
        body: JSON.stringify({ compilationId: compilation.id })
      });
      setView(session);
      setStage("talk");
      setDownloadComplete(null);
      setNotice("The conversation is ready.");
    }, {
      pendingMessage: "Preparing the first question…",
      retryLabel: "Try starting the conversation again"
    });
  }

  async function discardCompilation() {
    await runAction(async () => {
      await requireSuccessfulResponse(
        await fetch("/api/compilation", { method: "DELETE" }),
        "This document could not be closed."
      );
      setCompilation(null);
      setNotice("Choose a form to begin.");
      requestStageFocus();
    }, {
      pendingMessage: "Closing this document…",
      retryLabel: "Try closing the document again"
    });
  }

  async function saveAnswer(value: string | string[]) {
    const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value.trim());
    if (!view?.nextField || !hasValue) return;
    await runAction(async () => {
      const nextView = await requestJson<SessionView>("/api/session/answer", {
        method: "POST",
        body: JSON.stringify({
          fieldId: view.nextField?.id,
          value,
          sessionVersion: view.session.version
        })
      });
      setView(nextView);
      setAnswer("");
      setDownloadComplete(null);
      requestStageFocus();
      setNotice(nextView.nextField ? "Answer saved. Here is the next question." : "All questions have been visited.");
      if (!nextView.nextField) setStage("review");
    }, {
      pendingMessage: "Saving your answer…",
      retryLabel: "Try saving your answer again"
    });
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    await saveAnswer(answer);
  }

  async function skipCurrentAnswer() {
    if (!view?.nextField) return;
    await runAction(async () => {
      const nextView = await requestJson<SessionView>("/api/session/skip", {
        method: "POST",
        body: JSON.stringify({
          fieldId: view.nextField?.id,
          sessionVersion: view.session.version
        })
      });
      setView(nextView);
      setAnswer("");
      setDownloadComplete(null);
      requestStageFocus();
      setNotice("Question marked for review.");
      if (!nextView.nextField) setStage("review");
    }, {
      pendingMessage: "Marking this question for review…",
      retryLabel: "Try marking the question again"
    });
  }

  async function exportDraft() {
    await runAction(async () => {
      await downloadDraft();
      setDownloadComplete("draft");
      setNotice("Download complete. Your clearly marked draft is ready.");
    }, {
      pendingMessage: "Preparing your draft download…",
      renderingDownload: "draft",
      retryLabel: "Try the draft download again"
    });
  }

  async function runFinalVerification() {
    if (!view) return;
    await runAction(async () => {
      const nextView = await requestJson<SessionView>("/api/session/verify", {
        method: "POST",
        body: JSON.stringify({ sessionVersion: view.session.version })
      });
      setView(nextView);
      setDownloadComplete(null);
      setNotice(nextView.verification.readyForFinalExport
        ? `Final verification passed. ${nextView.exportPlan.description}`
        : verificationNotice(nextView));
    }, {
      pendingMessage: "Checking your saved answers without changing them…",
      retryLabel: "Try the final check again"
    });
  }

  async function resolveVerificationFinding(
    issue: VerificationIssue,
    action: VerificationAction,
    value?: string,
    fieldId?: string
  ) {
    if (!view) return;
    await runAction(async () => {
      const nextView = await requestJson<SessionView>(
        `/api/session/verification/issues/${encodeURIComponent(issue.id)}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            fieldId: fieldId ?? issue.fieldId,
            value: value ?? null,
            sessionVersion: view.session.version
          })
        }
      );
      setView(nextView);
      setDownloadComplete(null);
      setNotice(action === "confirm"
        ? "Confirmed exactly as written."
        : action === "leave_blank"
          ? "Intentionally left blank."
          : "Correction saved with explicit user provenance.");
    }, {
      pendingMessage: action === "confirm"
        ? "Saving your confirmation…"
        : action === "leave_blank"
          ? "Saving your choice to leave this blank…"
          : "Saving your correction…",
      retryLabel: "Try saving this review choice again"
    });
  }

  async function exportVerified() {
    await runAction(async () => {
      await downloadVerified();
      setDownloadComplete("final");
      setNotice(view?.exportPlan.kind === "filled_pdf"
        ? "Download complete. Your completed PDF is ready. The uploaded original was not changed."
        : view?.exportPlan.kind === "filled_docx"
          ? "Download complete. Your completed Word document is ready. The uploaded original was not changed."
          : "Download complete. Your verified answer packet is ready.");
    }, {
      pendingMessage: "Preparing your completed document…",
      renderingDownload: "final",
      retryLabel: "Try the completed download again"
    });
  }

  async function rememberAnswer(fieldId: string, subject: string) {
    if (!view) return;
    await runAction(async () => {
      const result = await requestJson<MemoryMutationResponse>("/api/memory/remember", {
        method: "POST",
        body: JSON.stringify({ fieldId, subject, sessionVersion: view.session.version })
      });
      acceptMemoryMutation(result);
      setNotice("Saved to your Memory Vault with your permission.");
    }, {
      pendingMessage: "Saving this approved detail to your Memory Vault…",
      retryLabel: "Try saving this detail again"
    });
  }

  async function applyMemorySuggestion(suggestion: MemorySuggestion) {
    if (!view) return;
    await runAction(async () => {
      const result = await requestJson<MemoryMutationResponse>("/api/memory/apply", {
        method: "POST",
        body: JSON.stringify({
          fieldId: suggestion.fieldId,
          claimId: suggestion.claimId,
          sessionVersion: view.session.version
        })
      });
      acceptMemoryMutation(result);
      setNotice(`${suggestion.fieldLabel} confirmed from your Memory Vault.`);
    }, {
      pendingMessage: "Applying the detail you approved…",
      retryLabel: "Try applying this detail again"
    });
  }

  async function correctMemory(claimId: string, value: string) {
    await runAction(async () => {
      const result = await requestJson<MemoryMutationResponse>(`/api/memory/claims/${encodeURIComponent(claimId)}`, {
        method: "PATCH",
        body: JSON.stringify({ value })
      });
      acceptMemoryMutation(result);
      setNotice("Remembered fact corrected. Existing form answers were left unchanged.");
    }, {
      pendingMessage: "Saving your Memory Vault correction…",
      retryLabel: "Try saving the correction again"
    });
  }

  async function forgetMemory(claimId: string) {
    await runAction(async () => {
      const result = await requestJson<MemoryMutationResponse>(`/api/memory/claims/${encodeURIComponent(claimId)}`, {
        method: "DELETE"
      });
      acceptMemoryMutation(result);
      setNotice("Forgotten. This fact will not be suggested on future forms.");
    }, {
      pendingMessage: "Removing this approved detail from your Memory Vault…",
      retryLabel: "Try forgetting this detail again"
    });
  }

  function acceptMemoryMutation(result: MemoryMutationResponse) {
    setMemory(result.memory);
    if (result.view) setView(result.view);
  }

  function closeMemory() {
    setMemoryOpen(false);
    window.requestAnimationFrame(() => memoryButtonRef.current?.focus());
  }

  async function resetSession() {
    await runAction(async () => {
      await requireSuccessfulResponse(
        await fetch("/api/session", { method: "DELETE" }),
        "This form could not be closed."
      );
      await requireSuccessfulResponse(
        await fetch("/api/compilation", { method: "DELETE" }),
        "The document check could not be cleared."
      );
      setView(null);
      setCompilation(null);
      setStage("upload");
      setAnswer("");
      setDownloadComplete(null);
      requestStageFocus();
      setNotice("Choose a form to begin.");
    }, {
      pendingMessage: "Closing this form and clearing the current session…",
      retryLabel: "Try closing this form again"
    });
  }

  function requestStageFocus() {
    setStageFocusRequest((request) => request + 1);
  }

  async function runAction(action: () => Promise<void>, options: ActionOptions) {
    if (options.renderingDownload) {
      setDownloadComplete(null);
      setDownloadRendering(options.renderingDownload);
    }
    setBusy(true);
    setBusyMessage(options.pendingMessage);
    setError(null);
    setRecovery(null);
    try {
      await action();
    } catch (actionError) {
      showError(actionError, options.retryLabel
        ? {
            label: options.retryLabel,
            run: () => runAction(action, options)
          }
        : null);
    } finally {
      if (options.renderingDownload) setDownloadRendering(null);
      setBusy(false);
    }
  }

  function showError(value: unknown, nextRecovery: RecoveryAction | null = null) {
    const message = value instanceof Error ? value.message : "Something went wrong.";
    setError(message);
    setRecovery(nextRecovery);
  }

  function dismissError() {
    setError(null);
    setRecovery(null);
    setNotice("Ready when you are.");
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to the form</a>
      <header className="site-header">
        <a className="brand" href="#main-content" aria-label="VocaForm home">
          <img src={logoUrl} alt="" />
          <span>
            <strong>VocaForm</strong>
            <small>Paperwork, made human.</small>
          </span>
        </a>
        <div className="header-actions">
          <button
            ref={memoryButtonRef}
            type="button"
            className="memory-button"
            aria-label={`Memory, ${memory?.claims.length ?? 0} remembered facts`}
            disabled={busy}
            onClick={() => setMemoryOpen(true)}
          >
            Memory
            <span aria-hidden="true">{memory?.claims.length ?? 0}</span>
          </button>
          <div className="privacy-note">
            <span aria-hidden="true">●</span>
            {health?.deployment.publicDemo ? "Synthetic demo" : "Private by design"}
          </div>
        </div>
      </header>

      {health?.deployment.publicDemo && (
        <aside className="public-demo-notice" aria-labelledby="public-demo-title">
          <strong id="public-demo-title">Public synthetic-data demo</strong>
          <span>
            Use reviewed sample information only. Do not enter personal, medical, or confidential information.
            Your active form and demo Memory Vault are isolated to this browser session and are not written to demo storage.
            The session expires after at most two hours and may disappear when the server restarts.{" "}
            {health.deployment.storage === "ephemeral"
              ? "The host filesystem is also temporary."
              : "The host filesystem is persistent, but public visitor state is not stored there."}
          </span>
        </aside>
      )}

      {memoryOpen && (
        <MemoryView
          busy={busy}
          candidates={view?.memory.rememberableAnswers ?? []}
          formLocale={view?.session.form.locale ?? null}
          memory={memory}
          onClose={closeMemory}
          onCorrect={correctMemory}
          onForget={forgetMemory}
          onRemember={rememberAnswer}
        />
      )}

      <main id="main-content" tabIndex={-1} className={view || compilation ? "main-content active" : "main-content"}>
        {!view && !compilation ? (
          <section className="hero-copy" aria-labelledby="page-title">
            <p className="eyebrow">A calmer way through everyday forms</p>
            <h1 id="page-title">One form. One conversation. Done.</h1>
            <p>
              VocaForm understands the paperwork, asks only what it needs, and prepares a document you can review and share.
            </p>
          </section>
        ) : (
          <h1 className="sr-only">VocaForm: {stageLabels[stage]}</h1>
        )}

        <nav className="journey" aria-label="Form steps">
          {(Object.keys(stageLabels) as Stage[]).map((item, index) => {
            const active = stage === item;
            const enabled = item === "upload" || Boolean(view);
            return (
              <button
                key={item}
                type="button"
                className={active ? "journey-step active" : "journey-step"}
                aria-current={active ? "step" : undefined}
                disabled={!enabled || busy}
                onClick={() => setStage(item)}
              >
                <span>{index + 1}</span>
                {stageLabels[item]}
              </button>
            );
          })}
        </nav>

        <div className="workspace">
          <section className="experience-card" aria-label={`${stageLabels[stage]} step`} aria-busy={busy}>
            {stage === "upload" && (
              <UnderstandStage
                busy={busy}
                compilation={compilation}
                fixtures={fixtures}
                openAiConfigured={Boolean(health?.openai.configured)}
                view={view}
                onCompile={compileFile}
                onDiscardCompilation={discardCompilation}
                onOpenFixture={openFixture}
                onApplyMemory={applyMemorySuggestion}
                onStartCompiled={startCompiledForm}
                onStart={() => setStage("talk")}
              />
            )}
            {stage === "talk" && view && (
              <TalkStage
                answer={answer}
                busy={busy}
                currentField={view.nextField}
                currentSectionTitle={currentSection?.title || "Form details"}
                realtime={realtime}
                view={view}
                onAnswerChange={setAnswer}
                onReview={() => setStage("review")}
                onApplyMemory={applyMemorySuggestion}
                onSkip={skipCurrentAnswer}
                onSubmit={submitAnswer}
                onSubmitChoice={saveAnswer}
              />
            )}
            {stage === "review" && view && (
              <ReviewStage
                busy={busy}
                openAiConfigured={Boolean(health?.openai.configured)}
                view={view}
                onContinue={() => setStage("talk")}
                onDownload={() => setStage("download")}
                onRemember={rememberAnswer}
                onReset={resetSession}
                onResolve={resolveVerificationFinding}
                onVerify={runFinalVerification}
              />
            )}
            {stage === "download" && view && (
              <DownloadStage
                busy={busy}
                complete={downloadComplete}
                rendering={downloadRendering}
                view={view}
                onDraftExport={exportDraft}
                onFinalExport={exportVerified}
                onReset={resetSession}
                onReview={() => setStage("review")}
              />
            )}
          </section>

          <aside className="status-card" aria-labelledby="form-status-title">
            <h2 id="form-status-title" className="status-label">Today’s form</h2>
            {view ? (
              <>
                <h3 dir="auto" lang={view.session.form.locale}>{view.session.form.title}</h3>
                <p>{view.session.form.source.fileName}</p>
                <div className="progress-copy">
                  <strong>{view.summary.completionPercent}%</strong>
                  <span>{view.summary.handledFields} of {view.summary.totalFields} complete</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Form completion"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={view.summary.completionPercent}
                  aria-valuetext={`${view.summary.handledFields} of ${view.summary.totalFields} questions complete`}
                >
                  <span style={{ width: `${view.summary.completionPercent}%` }} />
                </div>
                <dl className="status-facts">
                  <div><dt>Required left</dt><dd>{view.summary.requiredOpen}</dd></div>
                  <div><dt>Answered</dt><dd>{view.summary.answeredFields}</dd></div>
                  {view.summary.handledFields > view.summary.answeredFields && (
                    <div>
                      <dt>Skipped / not needed</dt>
                      <dd>{view.summary.handledFields - view.summary.answeredFields}</dd>
                    </div>
                  )}
                  <div><dt>Sections</dt><dd>{view.session.form.sections.length}</dd></div>
                  <div><dt>Draft ready</dt><dd>Yes</dd></div>
                  <div>
                    <dt>Final export</dt>
                    <dd>{view.verification.readyForFinalExport
                      ? "Ready"
                      : view.verification.issues.some((issue) => issue.severity === "blocker" && !issue.resolved)
                        ? "Blocked"
                        : view.verification.semanticStatus === "unavailable"
                          ? "Unavailable"
                          : view.verification.semanticStatus === "error" ? "Retry" : "Verify"}</dd>
                  </div>
                  <div><dt>Output</dt><dd>{exportKindLabel(view.exportPlan.kind)}</dd></div>
                </dl>
              </>
            ) : compilation ? (
              <>
                <h3 dir="auto" lang={compilation.form?.locale}>{compilation.form?.title || "Uploaded document"}</h3>
                <p>{compilation.form?.source.fileName || "Document check"}</p>
                <div className="progress-copy">
                  <strong>{compilation.readiness.score}</strong>
                  <span>readiness score</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Compilation readiness"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={compilation.readiness.score}
                  aria-valuetext={`${compilation.readiness.score} out of 100 ready`}
                >
                  <span style={{ width: `${compilation.readiness.score}%` }} />
                </div>
                <dl className="status-facts">
                  <div><dt>Questions</dt><dd>{compilation.readiness.fieldCount}</dd></div>
                  <div><dt>Evidence</dt><dd>{compilation.readiness.evidenceCoveragePercent}%</dd></div>
                  <div><dt>Ready</dt><dd>{compilation.readiness.ready ? "Yes" : "Check"}</dd></div>
                </dl>
              </>
            ) : (
              <div className="empty-status">
                <span aria-hidden="true">○</span>
                <p>No form open yet.</p>
              </div>
            )}
            <div className="system-state">
              <span className={health?.openai.configured ? "state-dot connected" : "state-dot"} aria-hidden="true" />
              {health?.deployment.publicDemo
                ? "Public demo ready"
                : health?.openai.configured ? "Private upload ready" : "Reviewed samples ready"}
            </div>
          </aside>
        </div>

        {error ? (
          <div className="notice error" role="alert" aria-atomic="true">
            <div>
              <strong>Something needs attention.</strong>
              <span>{error}</span>
            </div>
            <div className="notice-actions">
              {recovery && (
                <button type="button" onClick={() => void recovery.run()}>{recovery.label}</button>
              )}
              <button type="button" onClick={dismissError}>Dismiss</button>
            </div>
          </div>
        ) : (
          <div className={busy ? "notice busy" : "notice"} role="status" aria-live="polite" aria-atomic="true">
            <span className="notice-state" aria-hidden="true">{busy ? "…" : "✓"}</span>
            <span>{busy ? busyMessage : notice}</span>
          </div>
        )}
      </main>

      <footer>
        <span>VocaForm</span>
        <span>{health?.deployment.publicDemo
          ? "Public demo: use synthetic data only."
          : "Your answers stay under your control."}</span>
      </footer>
    </div>
  );
}

interface UnderstandStageProps {
  busy: boolean;
  compilation: CompilationResult | null;
  fixtures: FixtureSummary[];
  openAiConfigured: boolean;
  view: SessionView | null;
  onApplyMemory: (suggestion: MemorySuggestion) => Promise<void>;
  onCompile: (file: File) => Promise<void>;
  onDiscardCompilation: () => Promise<void>;
  onOpenFixture: (fixtureId: string) => Promise<void>;
  onStartCompiled: () => Promise<void>;
  onStart: () => void;
}

function UnderstandStage(props: UnderstandStageProps) {
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const {
    busy,
    compilation,
    fixtures,
    openAiConfigured,
    view,
    onCompile,
    onDiscardCompilation,
    onOpenFixture,
    onApplyMemory,
    onStartCompiled,
    onStart
  } = props;
  if (!view && compilation) {
    return (
      <CompilationReadiness
        busy={busy}
        compilation={compilation}
        onDiscard={onDiscardCompilation}
        onStart={onStartCompiled}
      />
    );
  }

  if (!view) {
    return (
      <div className="stage-content understand-empty">
        <div className="stage-icon" aria-hidden="true">01</div>
        <p className="stage-kicker">Upload the form</p>
        <h2 data-stage-heading tabIndex={-1}>Choose the form you want help with.</h2>
        <p className="stage-lead">
          Upload a PDF, Word document, or text file. VocaForm will find the questions, keep them tied to the source, and prepare a calm conversation.
        </p>
        <label
          className={openAiConfigured && !busy ? "upload-button" : "upload-button disabled"}
          htmlFor="form-upload"
        >
          <span>Choose a form</span>
          <span aria-hidden="true">↑</span>
          <input
            id="form-upload"
            type="file"
            aria-describedby="form-upload-help"
            accept=".pdf,.docx,.txt,.text,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            disabled={!openAiConfigured || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onCompile(file);
              event.target.value = "";
            }}
          />
        </label>
        <p id="form-upload-help" className="button-note">
          {openAiConfigured
            ? "PDF, DOCX, TXT, or Markdown · maximum 10 MB"
            : "Private document upload is unavailable right now. You can still use a reviewed sample below."}
        </p>
        <div className="sample-divider"><span>or try a reviewed sample</span></div>
        <div className="sample-options" aria-label="Reviewed sample forms">
          {fixtures.map((fixture) => (
            <button
              key={fixture.id}
              type="button"
              className="sample-option"
              disabled={busy}
              onClick={() => void onOpenFixture(fixture.id)}
            >
              <span>{fixture.title}</span>
              <small>{fixture.description}</small>
              <strong>Open sample <span aria-hidden="true">→</span></strong>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const fields = view.session.form.sections.flatMap((section) => section.fields);
  const evidenceCount = fields.filter((field) => field.evidence.length > 0).length;
  return (
    <div className="stage-content">
      <p className="stage-kicker">Form understood</p>
      <h2 data-stage-heading dir="auto" lang={view.session.form.locale} tabIndex={-1}>{view.session.form.title}</h2>
      <p className="stage-lead">
        The form is organized into {view.session.form.sections.length} sections. VocaForm found {fields.length} questions and prepared a clear route through them.
      </p>
      <div className="understanding-grid">
        <Metric value={fields.length} label="questions" />
        <Metric value={fields.filter((field) => field.required).length} label="required" />
        <Metric value={evidenceCount} label="with source evidence" />
      </div>
      <div className="confidence-message">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>Ready for a conversation</strong>
          <p>You can review every answer before anything is exported.</p>
        </div>
      </div>
      {view.memory.suggestions.length > 0 && (
        <MemorySuggestions
          busy={busy}
          fallbackFocusRef={startButtonRef}
          locale={view.session.form.locale}
          suggestions={view.memory.suggestions}
          onApply={onApplyMemory}
        />
      )}
      <button ref={startButtonRef} type="button" className="primary-button" disabled={busy} onClick={onStart}>
        Start answering
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

interface CompilationReadinessProps {
  busy: boolean;
  compilation: CompilationResult;
  onDiscard: () => Promise<void>;
  onStart: () => Promise<void>;
}

function CompilationReadiness({ busy, compilation, onDiscard, onStart }: CompilationReadinessProps) {
  const { form, readiness } = compilation;
  const blockers = readiness.issues.filter((issue) => issue.severity === "blocker");
  const warnings = readiness.issues.filter((issue) => issue.severity === "warning");

  return (
    <div className="stage-content compilation-stage">
      <p className="stage-kicker">Document readiness check</p>
      <h2 data-stage-heading dir="auto" lang={form?.locale} tabIndex={-1}>{form?.title || "This document needs another look."}</h2>
      <p className="stage-lead">{compilation.documentSummary}</p>

      <div className={readiness.ready ? "readiness-hero ready" : "readiness-hero attention"}>
        <strong>{readiness.score}</strong>
        <div>
          <span>Readiness score</span>
          <p>{readiness.ready
            ? "Every accepted question is grounded in the uploaded document."
            : `${blockers.length} ${blockers.length === 1 ? "finding blocks" : "findings block"} the interview.`}</p>
        </div>
      </div>

      <div className="understanding-grid">
        <Metric value={readiness.fieldCount} label="questions" />
        <Metric value={readiness.requiredFieldCount} label="required" />
        <Metric value={readiness.evidenceCoveragePercent} label="% with evidence" />
      </div>

      {readiness.issues.length > 0 && (
        <section className="readiness-issues" aria-labelledby="readiness-issues-title">
          <h3 id="readiness-issues-title">What VocaForm noticed</h3>
          <ul>
            {readiness.issues.map((item) => (
              <li key={item.id} className={item.severity}>
                <span aria-hidden="true">{item.severity === "blocker" ? "!" : "i"}</span>
                <p>{item.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {form && (
        <div className="compiled-sections">
          <h3>Questions found</h3>
          {form.sections.map((section) => (
            <details key={section.id}>
              <summary>
                <span dir="auto" lang={form.locale}>{section.title}</span>
                <small>{section.fields.length} {section.fields.length === 1 ? "question" : "questions"}</small>
              </summary>
              <ul>
                {section.fields.map((field) => (
                  <li key={field.id}>
                    <div>
                      <strong dir="auto" lang={form.locale}>{field.label}</strong>
                      <span>{field.required ? "Required" : "Optional"}</span>
                    </div>
                    <q dir="auto" lang={field.evidence[0]?.text ? form.locale : undefined}>{field.evidence[0]?.text || "No source quote"}</q>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}

      <div className="review-actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={() => void onDiscard()}>
          Choose another file
        </button>
        <button
          type="button"
          className="primary-button compact"
          disabled={busy || !readiness.ready || !form}
          onClick={() => void onStart()}
        >
          Start the conversation <span aria-hidden="true">→</span>
        </button>
      </div>
      {warnings.length > 0 && blockers.length === 0 && (
        <p className="button-note">You can continue with {warnings.length} non-blocking {warnings.length === 1 ? "note" : "notes"} and review every answer before export.</p>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

interface TalkStageProps {
  answer: string;
  busy: boolean;
  currentField: FormField | null;
  currentSectionTitle: string;
  realtime: {
    state: RealtimeInterviewState;
    assistantText: string;
    error: string | null;
    supported: boolean;
    start: () => Promise<void>;
    stop: () => void;
  };
  view: SessionView;
  onApplyMemory: (suggestion: MemorySuggestion) => Promise<void>;
  onAnswerChange: (value: string) => void;
  onReview: () => void;
  onSkip: () => Promise<void>;
  onSubmit: (event: FormEvent) => Promise<void>;
  onSubmitChoice: (value: string | string[]) => Promise<void>;
}

function TalkStage(props: TalkStageProps) {
  const { answer, busy, currentField, currentSectionTitle, view } = props;
  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const choiceButtonRef = useRef<HTMLButtonElement>(null);
  const voiceAvailable = props.realtime.supported;
  const [mode, setMode] = useState<"voice" | "type">(voiceAvailable ? "voice" : "type");
  const [closedChoiceFieldId, setClosedChoiceFieldId] = useState<string | null>(null);
  const voiceActive = !["idle", "error", "complete"].includes(props.realtime.state);
  const choiceQuestion = hasPresentedChoices(currentField);
  const choiceModalOpen = mode === "type"
    && choiceQuestion
    && closedChoiceFieldId !== currentField?.id;

  function selectMode(nextMode: "voice" | "type") {
    if (nextMode === "type") props.realtime.stop();
    if (nextMode === "type") setClosedChoiceFieldId(null);
    setMode(nextMode);
  }

  function closeChoiceModal() {
    if (!currentField) return;
    setClosedChoiceFieldId(currentField.id);
    window.requestAnimationFrame(() => choiceButtonRef.current?.focus());
  }

  if (!currentField) {
    return (
      <div className="stage-content complete-state">
        <div className="stage-icon success" aria-hidden="true">✓</div>
        <p className="stage-kicker">Conversation complete</p>
        <h2 data-stage-heading tabIndex={-1}>You have reached the end of the form.</h2>
        <p className="stage-lead">Review the answers and resolve anything that still needs attention.</p>
        <button type="button" className="primary-button" onClick={props.onReview}>Review the form <span aria-hidden="true">→</span></button>
      </div>
    );
  }

  return (
    <div className="stage-content talk-stage">
      {view.memory.suggestions.length > 0 && (
        <MemorySuggestions
          busy={busy}
          fallbackFocusRef={typeButtonRef}
          suggestions={view.memory.suggestions}
          onApply={props.onApplyMemory}
          compact
          locale={view.session.form.locale}
        />
      )}
      <div className="question-meta">
        <span dir="auto" lang={currentSectionTitle === "Form details" ? undefined : view.session.form.locale}>{currentSectionTitle}</span>
        <span>{currentField.required ? "Required question" : "Optional question"} · {view.summary.openFields} open</span>
      </div>
      <div className="answer-mode" role="group" aria-label="How to answer">
        <button
          ref={typeButtonRef}
          type="button"
          aria-pressed={mode === "voice"}
          aria-describedby={!voiceAvailable ? "voice-unavailable-help" : undefined}
          disabled={!voiceAvailable}
          onClick={() => selectMode("voice")}
        >
          Voice
        </button>
        <button
          type="button"
          aria-pressed={mode === "type"}
          onClick={() => selectMode("type")}
        >
          Type
        </button>
      </div>
      {!voiceAvailable && (
        <p id="voice-unavailable-help" className="mode-help">Voice is unavailable right now. Typing is ready.</p>
      )}

      {mode === "voice" ? (
        <div id="voice-answer-panel" className={`voice-panel state-${props.realtime.state}`}>
          <div className="voice-presence" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <p className="voice-status" role="status" aria-live="polite">
            {voiceStateLabel(props.realtime.state)}
          </p>
          <h2
            data-stage-heading
            dir="auto"
            lang={props.realtime.assistantText ? view.session.form.locale : undefined}
            tabIndex={-1}
          >
            {props.realtime.assistantText || "Ready for a calm conversation?"}
          </h2>
          <p className="voice-guidance" role={props.realtime.error ? "alert" : undefined}>
            {props.realtime.error || (voiceActive
              ? "Speak naturally. You can pause, correct yourself, or interrupt at any time."
              : "VocaForm will ask one question at a time and save only what you say.")}
          </p>
          <button
            type="button"
            className={voiceActive ? "voice-button active" : "voice-button"}
            disabled={props.realtime.state === "complete"}
            onClick={() => voiceActive ? props.realtime.stop() : void props.realtime.start()}
          >
            <span aria-hidden="true">{voiceActive ? "■" : "●"}</span>
            {voiceActive
              ? "End voice conversation"
              : props.realtime.state === "error" ? "Try voice again" : "Start voice conversation"}
          </button>
          <p className="privacy-copy">Your microphone is used only while this conversation is active.</p>
        </div>
      ) : (
        <div id="text-answer-panel" className="text-answer-panel">
          <p className="stage-kicker">One question at a time</p>
          <h2 data-stage-heading dir="auto" lang={view.session.form.locale} tabIndex={-1}>{currentField.interviewPrompt}</h2>
          {currentField.examples.length > 0 && (
            <p id="answer-help" className="question-help">
              For example: <span dir="auto" lang={view.session.form.locale}>{currentField.examples.slice(0, 2).join(" · ")}</span>
            </p>
          )}
          {choiceQuestion ? (
            <div className="choice-picker">
              <p>{currentField.type === "multi_choice"
                ? "Choose one or more answers from the options shown on the form."
                : "Choose one answer from the options shown on the form."}</p>
              <button
                ref={choiceButtonRef}
                type="button"
                className="primary-button compact"
                disabled={busy}
                onClick={() => setClosedChoiceFieldId(null)}
              >
                {closedChoiceFieldId === currentField.id ? "Choose an answer" : "Answer choices open"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : (
            <form onSubmit={(event) => void props.onSubmit(event)}>
              <label htmlFor="answer">Your answer</label>
              <textarea
                id="answer"
                dir="auto"
                aria-describedby={currentField.examples.length > 0 ? "answer-help" : undefined}
                aria-required={currentField.required}
                value={answer}
                onChange={(event) => props.onAnswerChange(event.target.value)}
                placeholder="Type naturally. You can use your own words."
                rows={5}
                disabled={busy}
                autoFocus
              />
              <div className="form-actions">
                <button type="button" className="quiet-button" disabled={busy} onClick={() => void props.onSkip()}>
                  I’ll answer this later
                </button>
                <button type="submit" className="primary-button compact" disabled={busy || !answer.trim()}>
                  Save and continue <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {choiceModalOpen && (
        <ChoiceQuestionModal
          key={currentField.id}
          busy={busy}
          field={currentField}
          locale={view.session.form.locale}
          onClose={closeChoiceModal}
          onSkip={props.onSkip}
          onSubmit={props.onSubmitChoice}
        />
      )}
      <button type="button" className="text-button" disabled={busy} onClick={props.onReview}>Review what I have so far</button>
    </div>
  );
}

function hasPresentedChoices(field: FormField | null): boolean {
  return Boolean(field
    && field.options.length > 0
    && ["boolean", "single_choice", "multi_choice"].includes(field.type));
}

function voiceStateLabel(state: RealtimeInterviewState): string {
  return ({
    idle: "Voice is ready",
    requesting_microphone: "Waiting for microphone permission",
    connecting: "Connecting securely",
    ready: "Connected",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    saving: "Saving your answer",
    reconnecting: "Reconnecting",
    error: "Voice needs attention",
    complete: "Conversation complete"
  } satisfies Record<RealtimeInterviewState, string>)[state];
}

interface ReviewStageProps {
  busy: boolean;
  openAiConfigured: boolean;
  view: SessionView;
  onContinue: () => void;
  onDownload: () => void;
  onRemember: (fieldId: string, subject: string) => Promise<void>;
  onReset: () => Promise<void>;
  onResolve: (
    issue: VerificationIssue,
    action: VerificationAction,
    value?: string,
    fieldId?: string
  ) => Promise<void>;
  onVerify: () => Promise<void>;
}

function ReviewStage(props: ReviewStageProps) {
  const { busy, view, onContinue, onDownload, onRemember, onReset } = props;
  const afterMemoryRef = useRef<HTMLButtonElement>(null);
  const answered = Object.values(view.session.answers).filter((answer) => answer.status === "answered");
  const blockers = view.verification.issues.filter((issue) => issue.severity === "blocker" && !issue.resolved);
  const ready = view.verification.readyForFinalExport;
  const semanticUnavailable = view.verification.semanticStatus === "unavailable";

  return (
    <div className="stage-content review-stage">
      <p className="stage-kicker">Review before sharing</p>
      <h2 data-stage-heading tabIndex={-1}>{answered.length === 0 ? "Your draft is ready to begin." : `${answered.length} answers saved.`}</h2>
      <p className="stage-lead">
        {ready
          ? "Every blocking finding is resolved and the final verification passed."
          : blockers.length > 0
            ? `${blockers.length} ${blockers.length === 1 ? "finding needs" : "findings need"} attention before final export. You can still download a clearly marked draft.`
            : semanticUnavailable
              ? "The automatic meaning check is unavailable. A clearly marked draft remains available."
              : "The deterministic checks passed. Run final verification before exporting the completed document."}
      </p>

      <div className={ready ? "review-banner ready" : blockers.length ? "review-banner attention" : "review-banner verify"}>
        <span aria-hidden="true">{ready ? "✓" : blockers.length ? "!" : "i"}</span>
        <div>
          <strong>{ready
            ? "Verified and ready for final export"
            : blockers.length
              ? "A few things still need you"
              : semanticUnavailable ? "Final verification is unavailable" : "Ready for the final check"}</strong>
          <p>{ready
            ? "The verifier did not change any answer."
            : blockers.length
              ? "Resolve each blocker here without restarting the interview."
              : semanticUnavailable
                ? "You can continue to Download and save a clearly marked draft."
                : "The final check looks for contradictions, ambiguity, and unsupported claims without editing the form."}</p>
        </div>
      </div>

      <VerificationPanel
        busy={busy}
        openAiConfigured={props.openAiConfigured}
        view={view}
        onResolve={props.onResolve}
        onVerify={props.onVerify}
      />

      {answered.length > 0 && (
        <div className="answer-list">
          <h3>Saved answers</h3>
          {answered.slice(0, 4).map((item) => (
            <div key={item.fieldId} className="answer-row">
              <span aria-hidden="true">✓</span>
              <div>
                <strong dir="auto" lang={view.session.form.locale}>{findFieldLabel(view, item.fieldId)}</strong>
                <p dir="auto">{formatAnswer(item.normalizedAnswer)}</p>
                {item.source === "memory" && <small className="memory-source">Confirmed from your Memory Vault</small>}
              </div>
            </div>
          ))}
          {answered.length > 4 && <p className="more-copy">And {answered.length - 4} more saved answers.</p>}
        </div>
      )}

      {view.memory.confirmedPrefills.length > 0 && (
        <div className="answer-list memory-prefills">
          <h3>Profile details confirmed from memory</h3>
          {view.memory.confirmedPrefills.map((item) => (
            <div key={item.fieldId} className="answer-row">
              <span aria-hidden="true">✓</span>
              <div>
                <strong dir="auto" lang={view.session.form.locale}>{item.fieldLabel}</strong>
                <p>{formatValue(item.value)}</p>
                <small className="memory-source">Confirmed from your Memory Vault</small>
              </div>
            </div>
          ))}
        </div>
      )}

      {view.memory.rememberableAnswers.length > 0 && (
        <RememberCandidates
          busy={busy}
          candidates={view.memory.rememberableAnswers}
          fallbackFocusRef={afterMemoryRef}
          locale={view.session.form.locale}
          onRemember={onRemember}
        />
      )}

      <div className="review-actions">
        <button
          ref={afterMemoryRef}
          type="button"
          className="quiet-button"
          disabled={busy}
          onClick={onContinue}
        >
          Continue answering
        </button>
        <button
          type="button"
          className="primary-button compact"
          disabled={busy}
          onClick={onDownload}
        >
          Continue to download <span aria-hidden="true">→</span>
        </button>
      </div>
      <button type="button" className="text-button danger" disabled={busy} onClick={() => void onReset()}>Close this form and start over</button>
    </div>
  );
}

interface DownloadStageProps {
  busy: boolean;
  complete: DownloadComplete;
  rendering: DownloadComplete;
  view: SessionView;
  onDraftExport: () => Promise<void>;
  onFinalExport: () => Promise<void>;
  onReset: () => Promise<void>;
  onReview: () => void;
}

function DownloadStage(props: DownloadStageProps) {
  const { busy, complete, rendering, view } = props;
  const ready = view.verification.readyForFinalExport;
  const unresolvedBlockers = view.verification.issues.filter((issue) =>
    issue.severity === "blocker" && !issue.resolved
  ).length;

  return (
    <div className="stage-content download-stage">
      <p className="stage-kicker">Download your document</p>
      <h2 data-stage-heading tabIndex={-1}>
        {ready ? "Your completed document is ready." : "Your draft is ready."}
      </h2>
      <p className="stage-lead">
        {ready
          ? "The final check passed. Download a new completed file; your uploaded original stays unchanged."
          : "You can download a clearly marked draft now, or return to Review to finish the checks for a completed document."}
      </p>

      {rendering && (
        <div className="download-rendering" role="status" aria-live="polite" aria-atomic="true">
          <span className="download-spinner" aria-hidden="true" />
          <div>
            <strong>{rendering === "draft" ? "Creating your draft…" : "Rendering your completed document…"}</strong>
            <p>{rendering === "draft"
              ? "Keep this page open. The DOCX download will start automatically when it is ready."
              : view.exportPlan.kind === "filled_pdf"
                ? "VocaForm is filling a new PDF. Your uploaded original stays unchanged."
                : view.exportPlan.kind === "filled_docx"
                  ? "VocaForm is filling a new Word document. Your uploaded original stays unchanged."
                  : "VocaForm is building your verified DOCX answer packet."}</p>
          </div>
        </div>
      )}

      {complete && (
        <div className="download-complete">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Download complete</strong>
            <p>{complete === "final"
              ? "Your completed document was sent to your browser’s downloads."
              : "Your clearly marked draft was sent to your browser’s downloads."}</p>
          </div>
        </div>
      )}

      <section className={ready ? "download-option ready" : "download-option waiting"} aria-labelledby="completed-download-title">
        <div className="download-option-heading">
          <span aria-hidden="true">{ready ? "✓" : "i"}</span>
          <div>
            <h3 id="completed-download-title">{exportKindLabel(view.exportPlan.kind)}</h3>
            <p>{view.exportPlan.description}</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Original file</dt>
            <dd>{view.exportPlan.sourceAvailable ? "Preserved unchanged" : "Referenced by the answer packet"}</dd>
          </div>
          <div>
            <dt>Final check</dt>
            <dd>{ready ? "Passed" : unresolvedBlockers > 0 ? `${unresolvedBlockers} to resolve` : "Not available"}</dd>
          </div>
        </dl>
        {!ready && (
          <p id="final-download-help" className="download-help">
            {unresolvedBlockers > 0
              ? "Return to Review and resolve every item marked Needs you."
              : "The automatic meaning check is unavailable, so completed export remains locked. Draft download still works."}
          </p>
        )}
      </section>

      <div className="review-actions download-actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={props.onReview}>
          Back to review
        </button>
        <button type="button" className="quiet-button" disabled={busy} onClick={() => void props.onDraftExport()}>
          {rendering === "draft" ? "Creating draft…" : "Download draft DOCX"} <span aria-hidden="true">↓</span>
        </button>
        <button
          type="button"
          className="primary-button compact"
          aria-describedby={!ready ? "final-download-help" : undefined}
          disabled={busy || !ready}
          onClick={() => void props.onFinalExport()}
        >
          {rendering === "final" ? "Rendering document…" : view.exportPlan.buttonLabel} <span aria-hidden="true">↓</span>
        </button>
      </div>
      <button type="button" className="text-button danger" disabled={busy} onClick={() => void props.onReset()}>
        Close this form and start over
      </button>
    </div>
  );
}

interface VerificationPanelProps {
  busy: boolean;
  openAiConfigured: boolean;
  view: SessionView;
  onResolve: ReviewStageProps["onResolve"];
  onVerify: () => Promise<void>;
}

function VerificationPanel(props: VerificationPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<{ issueId: string; action: "answer" | "correct" } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [targetFieldId, setTargetFieldId] = useState("");
  const activeIssues = props.view.verification.issues.filter((issue) => !issue.resolved);
  const resolvedCount = props.view.verification.issues.length - activeIssues.length;
  const blockers = activeIssues.filter((issue) => issue.severity === "blocker");
  const canRunSemantic = blockers.length === 0 && props.openAiConfigured;

  function beginEdit(issue: VerificationIssue, action: "answer" | "correct") {
    setEditing({ issueId: issue.id, action });
    setTargetFieldId(issue.fieldId || issue.relatedFieldIds[0] || "");
    setDraftValue(currentAnswerText(props.view, issue.fieldId));
  }

  function cancelEdit() {
    setEditing(null);
    setTargetFieldId("");
    setDraftValue("");
  }

  async function resolveAndRestoreFocus(
    issue: VerificationIssue,
    action: VerificationAction,
    value?: string,
    fieldId?: string
  ) {
    await props.onResolve(issue, action, value, fieldId);
    cancelEdit();
    window.requestAnimationFrame(() => {
      const nextAction = panelRef.current?.querySelector<HTMLButtonElement>(
        ".finding-actions button:not([disabled]), .verification-run button:not([disabled])"
      );
      (nextAction ?? panelRef.current)?.focus();
    });
  }

  return (
    <section ref={panelRef} className="verification-panel" aria-labelledby="verification-title" tabIndex={-1}>
      <div className="verification-heading">
        <div>
          <p className="stage-kicker">Final verification</p>
          <h3 id="verification-title">Why this form is—or is not—ready</h3>
        </div>
        <span className={`verification-status status-${props.view.verification.semanticStatus}`}>
          {verificationStatusLabel(props.view)}
        </span>
      </div>

      {activeIssues.length > 0 && (
        <div className="finding-list">
          {activeIssues.map((issue) => {
            const editableAction = issue.actions.find((action): action is "answer" | "correct" =>
              action === "answer" || action === "correct");
            const issueFieldIds = [issue.fieldId, ...issue.relatedFieldIds]
              .filter((fieldId): fieldId is string => Boolean(fieldId));
            const isEditing = editing?.issueId === issue.id;
            const issueLabel = verificationFieldLabel(props.view, issue.fieldId);
            return (
              <article key={issue.id} className={`finding-card ${issue.severity}`}>
                <div className="finding-copy">
                  <div className="finding-meta">
                    <span>{issue.severity === "blocker" ? "Needs you" : "Check"}</span>
                    <small>{issue.source === "model" ? "Automatic meaning check" : "Form rule check"}</small>
                  </div>
                  <strong dir="auto" lang={issue.fieldId ? props.view.session.form.locale : undefined}>
                    {issueLabel}
                  </strong>
                  <p>{issue.message}</p>
                  <small className="finding-evidence">Why: {issue.evidence}</small>
                </div>

                {isEditing && editableAction ? (
                  <form
                    className="finding-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!draftValue.trim()) return;
                      void resolveAndRestoreFocus(issue, editableAction, draftValue.trim(), targetFieldId);
                    }}
                  >
                    {issueFieldIds.length > 1 && (
                      <label>
                        Answer to update for {issueLabel}
                        <select
                          value={targetFieldId}
                          onChange={(event) => {
                            setTargetFieldId(event.target.value);
                            setDraftValue(currentAnswerText(props.view, event.target.value));
                          }}
                        >
                          {issueFieldIds.map((fieldId) => (
                            <option key={fieldId} dir="auto" lang={props.view.session.form.locale} value={fieldId}>
                              {verificationFieldLabel(props.view, fieldId)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {editableAction === "answer" ? "Your answer for" : "Corrected answer for"} {issueLabel}
                      <textarea
                        rows={3}
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="finding-actions">
                      <button
                        type="button"
                        disabled={props.busy}
                        aria-label={`Cancel ${editableAction === "answer" ? "answer" : "correction"} for ${issueLabel}`}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={props.busy || !draftValue.trim()}
                        aria-label={`Save ${editableAction === "answer" ? "answer" : "correction"} for ${issueLabel}`}
                      >
                        Save explicitly
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="finding-actions">
                    {editableAction && (
                      <button
                        type="button"
                        disabled={props.busy}
                        aria-label={`${editableAction === "answer" ? "Answer now for" : "Correct"} ${issueLabel}`}
                        onClick={() => beginEdit(issue, editableAction)}
                      >
                        {editableAction === "answer" ? "Answer now" : "Correct"}
                      </button>
                    )}
                    {issue.actions.includes("confirm") && (
                      <button
                        type="button"
                        disabled={props.busy}
                        aria-label={`Confirm ${issueLabel} as written`}
                        onClick={() => void resolveAndRestoreFocus(issue, "confirm")}
                      >
                        Confirm as written
                      </button>
                    )}
                    {issue.actions.includes("leave_blank") && (
                      <button
                        className="leave-blank"
                        type="button"
                        disabled={props.busy}
                        aria-label={`Leave ${issueLabel} blank`}
                        onClick={() => void resolveAndRestoreFocus(issue, "leave_blank")}
                      >
                        Leave blank
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {resolvedCount > 0 && <p className="resolved-copy">✓ {resolvedCount} {resolvedCount === 1 ? "finding resolved" : "findings resolved"} by you.</p>}

      <div className="verification-run">
        <div>
          <strong>{semanticCallToAction(props.view, props.openAiConfigured, blockers.length)}</strong>
          <p>{semanticStatusCopy(props.view, props.openAiConfigured, blockers.length)}</p>
        </div>
        {props.view.verification.semanticStatus !== "passed"
          && props.view.verification.semanticStatus !== "findings" && (
          <button type="button" disabled={props.busy || !canRunSemantic} onClick={() => void props.onVerify()}>
            {props.view.verification.semanticStatus === "error" ? "Try verification again" : "Run final verification"}
          </button>
        )}
      </div>
    </section>
  );
}

interface MemorySuggestionsProps {
  busy: boolean;
  compact?: boolean;
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
  locale: string;
  suggestions: MemorySuggestion[];
  onApply: (suggestion: MemorySuggestion) => Promise<void>;
}

function MemorySuggestions({
  busy,
  compact = false,
  fallbackFocusRef,
  locale,
  suggestions,
  onApply
}: MemorySuggestionsProps) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  async function handleApply(suggestion: MemorySuggestion, index: number) {
    const nextSuggestion = suggestions[index + 1] ?? suggestions[index - 1];
    await onApply(suggestion);
    window.requestAnimationFrame(() => {
      const nextKey = nextSuggestion ? `${nextSuggestion.fieldId}:${nextSuggestion.claimId}` : null;
      const nextButton = nextKey ? buttonRefs.current.get(nextKey) : null;
      (nextButton ?? fallbackFocusRef.current)?.focus();
    });
  }

  return (
    <section className={compact ? "memory-suggestions compact" : "memory-suggestions"} aria-label="Memory suggestions">
      <div className="memory-section-heading">
        <div>
          <p className="stage-kicker">From your Memory Vault</p>
          <h3>{suggestions.length === 1 ? "Use this remembered detail?" : "Use these remembered details?"}</h3>
        </div>
        <span>{suggestions.length}</span>
      </div>
      <p className="memory-explainer">Nothing has been filled yet. Confirm each detail before VocaForm uses it on this form.</p>
      <div className="memory-card-list">
        {suggestions.map((suggestion, index) => (
          <article key={`${suggestion.fieldId}:${suggestion.claimId}`} className="memory-suggestion-card">
            <div>
              <span dir="auto" lang={locale}>{suggestion.fieldLabel}</span>
              <strong dir="auto">{formatValue(suggestion.value)}</strong>
              <small>
                For {suggestion.subject} · remembered from{" "}
                <span dir="auto" lang={suggestion.sourceFormLocale || undefined}>{suggestion.sourceFormTitle}</span>
              </small>
            </div>
            <button
              ref={(element) => {
                const key = `${suggestion.fieldId}:${suggestion.claimId}`;
                if (element) buttonRefs.current.set(key, element);
                else buttonRefs.current.delete(key);
              }}
              type="button"
              disabled={busy}
              aria-label={`Use remembered ${suggestion.fieldLabel}`}
              onClick={() => void handleApply(suggestion, index)}
            >
              Use this
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

interface RememberCandidatesProps {
  busy: boolean;
  candidates: RememberableAnswer[];
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
  locale: string;
  onRemember: (fieldId: string, subject: string) => Promise<void>;
}

function RememberCandidates({ busy, candidates, fallbackFocusRef, locale, onRemember }: RememberCandidatesProps) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  async function handleRemember(candidate: RememberableAnswer, index: number) {
    const nextCandidateId = candidates[index + 1]?.fieldId ?? candidates[index - 1]?.fieldId;
    await onRemember(candidate.fieldId, candidate.subject);
    window.requestAnimationFrame(() => {
      const nextButton = nextCandidateId ? buttonRefs.current.get(nextCandidateId) : null;
      (nextButton ?? fallbackFocusRef.current)?.focus();
    });
  }

  return (
    <section className="remember-candidates" aria-label="Answers you can remember">
      <p className="stage-kicker">Save time next form</p>
      <h3>Would you like VocaForm to remember any of these?</h3>
      <p>Only stable contact details appear here. Nothing is stored unless you choose Remember.</p>
      <div className="memory-card-list">
        {candidates.map((candidate, index) => (
          <article key={candidate.fieldId} className="remember-candidate-card">
            <div>
              <span dir="auto" lang={locale}>{candidate.fieldLabel}</span>
              <strong dir="auto">{formatValue(candidate.value)}</strong>
              <small>{candidate.reason}</small>
            </div>
            <button
              ref={(element) => {
                if (element) buttonRefs.current.set(candidate.fieldId, element);
                else buttonRefs.current.delete(candidate.fieldId);
              }}
              type="button"
              disabled={busy}
              aria-label={`${candidate.action === "update" ? "Update memory for" : "Remember"} ${candidate.fieldLabel}`}
              onClick={() => void handleRemember(candidate, index)}
            >
              {candidate.action === "update" ? "Update memory" : "Remember"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

interface MemoryViewProps {
  busy: boolean;
  candidates: RememberableAnswer[];
  formLocale: string | null;
  memory: MemoryVaultView | null;
  onClose: () => void;
  onCorrect: (claimId: string, value: string) => Promise<void>;
  onForget: (claimId: string) => Promise<void>;
  onRemember: (fieldId: string, subject: string) => Promise<void>;
}

function MemoryView(props: MemoryViewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      closeButtonRef.current?.focus();
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function beginCorrection(claim: MemoryClaim) {
    setEditingClaimId(claim.id);
    setDraftValue(formatValue(claim.value));
  }

  async function submitCorrection(event: FormEvent, claimId: string) {
    event.preventDefault();
    if (!draftValue.trim()) return;
    await props.onCorrect(claimId, draftValue.trim());
    setEditingClaimId(null);
    setDraftValue("");
  }

  return (
    <dialog
      ref={dialogRef}
      className="memory-overlay"
      aria-labelledby="memory-title"
      aria-describedby="memory-description"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <section className="memory-drawer">
        <header>
          <div>
            <p className="stage-kicker">Your local Memory Vault</p>
            <h2 id="memory-title">What VocaForm remembers</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="drawer-close" aria-label="Close memory" onClick={props.onClose}>×</button>
        </header>
        <p id="memory-description" className="memory-drawer-lead">
          These facts were saved only after you approved them. Correct or forget anything here at any time.
        </p>

        {props.candidates.length > 0 && (
          <RememberCandidates
            busy={props.busy}
            candidates={props.candidates}
            fallbackFocusRef={closeButtonRef}
            locale={props.formLocale || "en"}
            onRemember={props.onRemember}
          />
        )}

        {!props.memory || props.memory.claims.length === 0 ? (
          <div className="empty-memory">
            <span aria-hidden="true">○</span>
            <h3>No approved facts yet</h3>
            <p>Stable contact details you choose to remember will appear here. Sensitive answers stay out by default.</p>
          </div>
        ) : (
          <div className="vault-claims">
            {props.memory.claims.map((claim) => (
              <article key={claim.id} className="vault-claim">
                <div className="claim-heading">
                  <div>
                    <span dir="auto" lang={claim.sourceFieldLabel ? claim.sourceFormLocale || undefined : undefined}>
                      {claim.sourceFieldLabel || humanizeMemoryKey(claim.key)}
                    </span>
                    <small>{claim.subject}</small>
                  </div>
                  <span className="approved-badge">Approved</span>
                </div>
                {editingClaimId === claim.id ? (
                  <form onSubmit={(event) => void submitCorrection(event, claim.id)}>
                    <label htmlFor={`memory-${claim.id}`}>
                      Correct remembered value for {claim.sourceFieldLabel || humanizeMemoryKey(claim.key)}
                    </label>
                    <input
                      id={`memory-${claim.id}`}
                      value={draftValue}
                      onChange={(event) => setDraftValue(event.target.value)}
                      disabled={props.busy}
                      autoFocus
                    />
                    <div className="claim-actions">
                      <button
                        type="button"
                        disabled={props.busy}
                        aria-label={`Cancel correction for ${claim.sourceFieldLabel || humanizeMemoryKey(claim.key)}`}
                        onClick={() => setEditingClaimId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={props.busy || !draftValue.trim()}
                        aria-label={`Save correction for ${claim.sourceFieldLabel || humanizeMemoryKey(claim.key)}`}
                      >
                        Save correction
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong className="claim-value" dir="auto">{formatValue(claim.value)}</strong>
                    <p>
                      Remembered from{" "}
                      <span dir="auto" lang={claim.sourceFormTitle ? claim.sourceFormLocale || undefined : undefined}>
                        {claim.sourceFormTitle || claim.sourceFormId}
                      </span>{" "}
                      on{" "}
                      <time dateTime={claim.confirmedAt ?? undefined}>{formatDate(claim.confirmedAt)}</time>.
                    </p>
                    <div className="claim-actions">
                      <button
                        type="button"
                        disabled={props.busy}
                        aria-label={`Correct ${claim.sourceFieldLabel || humanizeMemoryKey(claim.key)}`}
                        onClick={() => beginCorrection(claim)}
                      >
                        Correct
                      </button>
                      <button
                        type="button"
                        className="forget"
                        disabled={props.busy}
                        aria-label={`Forget ${claim.sourceFieldLabel || humanizeMemoryKey(claim.key)}`}
                        onClick={() => void props.onForget(claim.id)}
                      >
                        Forget
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
        <p className="memory-storage-note">Stored only in this VocaForm workspace. Conversation history is never used as memory.</p>
      </section>
    </dialog>
  );
}

function findFieldLabel(view: SessionView, fieldId: string): string {
  const prefillField = view.session.form.prefillFields.find((candidate) => candidate.id === fieldId);
  if (prefillField) return prefillField.label;
  for (const section of view.session.form.sections) {
    const field = section.fields.find((candidate) => candidate.id === fieldId);
    if (field) return field.label;
  }
  return fieldId;
}

function verificationFieldLabel(view: SessionView, fieldId: string | null): string {
  return fieldId ? findFieldLabel(view, fieldId) : "Whole form";
}

function currentAnswerText(view: SessionView, fieldId: string | null): string {
  if (!fieldId) return "";
  const answer = view.session.answers[fieldId] ?? view.session.prefillAnswers[fieldId];
  if (!answer || answer.status !== "answered") return "";
  return answer.normalizedAnswer ?? (answer.value === null ? "" : formatValue(answer.value));
}

function verificationStatusLabel(view: SessionView): string {
  if (view.verification.readyForFinalExport) return "Ready";
  return ({
    not_run: "Not run",
    unavailable: "Unavailable",
    passed: "Passed",
    findings: "Findings",
    error: "Needs retry"
  } satisfies Record<SessionView["verification"]["semanticStatus"], string>)[view.verification.semanticStatus];
}

function exportKindLabel(kind: SessionView["exportPlan"]["kind"]): string {
  return ({
    filled_docx: "Completed Word document",
    filled_pdf: "Completed fillable PDF",
    answer_packet: "Section-matched DOCX answer packet"
  } satisfies Record<SessionView["exportPlan"]["kind"], string>)[kind];
}

function semanticCallToAction(view: SessionView, configured: boolean, blockerCount: number): string {
  if (view.verification.readyForFinalExport) return "Every blocking finding is resolved";
  if (blockerCount > 0) return "Resolve the checks above first";
  if (!configured || view.verification.semanticStatus === "unavailable") return "The automatic meaning check is unavailable";
  if (view.verification.semanticStatus === "passed") return "The automatic meaning check passed";
  if (view.verification.semanticStatus === "findings") return "The final check found details for you to review";
  if (view.verification.semanticStatus === "error") return "The automatic meaning check needs another try";
  return "Run the final meaning check";
}

function semanticStatusCopy(view: SessionView, configured: boolean, blockerCount: number): string {
  if (view.verification.readyForFinalExport) {
    return "The final check is complete. Your answers were inspected, never rewritten.";
  }
  if (blockerCount > 0) {
    return "Final verification starts after every deterministic blocker has an explicit answer or correction.";
  }
  if (!configured || view.verification.semanticStatus === "unavailable") {
    return "A completed export needs the automatic meaning check. You can still continue to Download and save a clearly marked draft.";
  }
  if (view.verification.semanticStatus === "passed") {
    return "No semantic blockers were found. Your answers were inspected, never rewritten.";
  }
  if (view.verification.semanticStatus === "findings") {
    return "Confirm or correct every blocker here. The verifier will not silently change an answer.";
  }
  if (view.verification.semanticStatus === "error") {
    return "No answers changed. Retry when you are ready; final export stays locked until the check completes.";
  }
  return "The check reads the saved answers and their original wording, then reports findings without editing the form.";
}

function verificationNotice(view: SessionView): string {
  const blockers = view.verification.issues.filter((issue) => issue.severity === "blocker" && !issue.resolved);
  if (blockers.length > 0) {
    return `${blockers.length} ${blockers.length === 1 ? "finding needs" : "findings need"} your attention.`;
  }
  if (view.verification.semanticStatus === "unavailable") {
    return "Form rule checks passed, but the automatic meaning check is unavailable.";
  }
  if (view.verification.semanticStatus === "error") {
    return "Final verification did not complete. No answers were changed.";
  }
  return "Final verification completed with details to review.";
}

function formatAnswer(value: string | null): string {
  if (!value) return "No answer text saved.";
  return value.length > 150 ? `${value.slice(0, 147)}…` : value;
}

function formatValue(value: AnswerValue): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function humanizeMemoryKey(key: string): string {
  return key.split(/[._]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string | null): string {
  if (!value) return "an unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function requireSuccessfulResponse(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(payload?.error || fallbackMessage);
}
