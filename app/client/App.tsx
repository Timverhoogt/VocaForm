import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import type { RealtimeInterviewState } from "./realtime";
import { useRealtimeInterview } from "./use_realtime_interview";

type Stage = "understand" | "talk" | "review";

const stageLabels: Record<Stage, string> = {
  understand: "Understand",
  talk: "Talk",
  review: "Review"
};

export function App() {
  const memoryButtonRef = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<Stage>("understand");
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [view, setView] = useState<SessionView | null>(null);
  const [compilation, setCompilation] = useState<CompilationResult | null>(null);
  const [memory, setMemory] = useState<MemoryVaultView | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Preparing VocaForm…");
  const [error, setError] = useState<string | null>(null);
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
        setNotice(message);
      }
    }

    void initialize();
  }, []);

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
      setStage("understand");
      setNotice("VocaForm found the questions and prepared the conversation.");
    });
  }

  async function compileFile(file: File) {
    await runAction(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error("Choose a file smaller than 10 MB.");
      setNotice("GPT-5.6 Sol is reading the form and checking every question…");
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
      setStage("understand");
      setNotice(result.readiness.ready
        ? "The form is grounded and ready for a conversation."
        : "The form was read, but a few findings need attention.");
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
      setNotice("The conversation is ready.");
    });
  }

  async function discardCompilation() {
    await runAction(async () => {
      await fetch("/api/compilation", { method: "DELETE" });
      setCompilation(null);
      setNotice("Choose a form to begin.");
    });
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!view?.nextField || !answer.trim()) return;
    await runAction(async () => {
      const nextView = await requestJson<SessionView>("/api/session/answer", {
        method: "POST",
        body: JSON.stringify({
          fieldId: view.nextField?.id,
          value: answer,
          sessionVersion: view.session.version
        })
      });
      setView(nextView);
      setAnswer("");
      setNotice(nextView.nextField ? "Answer saved. Here is the next question." : "All questions have been visited.");
      if (!nextView.nextField) setStage("review");
    });
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
      setNotice("Question marked for review.");
      if (!nextView.nextField) setStage("review");
    });
  }

  async function exportDraft() {
    await runAction(async () => {
      await downloadDraft();
      setNotice("Your draft document is ready.");
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
      setNotice(nextView.verification.readyForFinalExport
        ? `Final verification passed. ${nextView.exportPlan.description}`
        : verificationNotice(nextView));
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
      setNotice(action === "confirm"
        ? "Confirmed exactly as written."
        : action === "leave_blank"
          ? "Intentionally left blank."
          : "Correction saved with explicit user provenance.");
    });
  }

  async function exportVerified() {
    await runAction(async () => {
      await downloadVerified();
      setNotice(view?.exportPlan.kind === "filled_pdf"
        ? "Your completed PDF is ready. The uploaded original was not changed."
        : view?.exportPlan.kind === "filled_docx"
          ? "Your completed Word document is ready. The uploaded original was not changed."
          : "Your verified answer packet is ready.");
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
    });
  }

  async function forgetMemory(claimId: string) {
    await runAction(async () => {
      const result = await requestJson<MemoryMutationResponse>(`/api/memory/claims/${encodeURIComponent(claimId)}`, {
        method: "DELETE"
      });
      acceptMemoryMutation(result);
      setNotice("Forgotten. This fact will not be suggested on future forms.");
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
      await fetch("/api/session", { method: "DELETE" });
      await fetch("/api/compilation", { method: "DELETE" });
      setView(null);
      setCompilation(null);
      setStage("understand");
      setAnswer("");
      setNotice("Choose a sample form to begin.");
    });
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      showError(actionError);
    } finally {
      setBusy(false);
    }
  }

  function showError(value: unknown) {
    const message = value instanceof Error ? value.message : "Something went wrong.";
    setError(message);
    setNotice(message);
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
          <button ref={memoryButtonRef} type="button" className="memory-button" onClick={() => setMemoryOpen(true)}>
            Memory
            <span aria-label={`${memory?.claims.length ?? 0} remembered facts`}>{memory?.claims.length ?? 0}</span>
          </button>
          <div className="privacy-note">
            <span aria-hidden="true">●</span>
            Private by design
          </div>
        </div>
      </header>

      {memoryOpen && (
        <MemoryView
          busy={busy}
          candidates={view?.memory.rememberableAnswers ?? []}
          memory={memory}
          onClose={closeMemory}
          onCorrect={correctMemory}
          onForget={forgetMemory}
          onRemember={rememberAnswer}
        />
      )}

      <main id="main-content" className={view || compilation ? "main-content active" : "main-content"}>
        {!view && !compilation && (
          <section className="hero-copy" aria-labelledby="page-title">
            <p className="eyebrow">A calmer way through everyday forms</p>
            <h1 id="page-title">One form. One conversation. Done.</h1>
            <p>
              VocaForm understands the paperwork, asks only what it needs, and prepares a document you can review and share.
            </p>
          </section>
        )}

        <nav className="journey" aria-label="Form progress">
          {(Object.keys(stageLabels) as Stage[]).map((item, index) => {
            const active = stage === item;
            const enabled = item === "understand" || Boolean(view);
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
          <section className="experience-card" aria-busy={busy}>
            {stage === "understand" && (
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
              />
            )}
            {stage === "review" && view && (
              <ReviewStage
                busy={busy}
                openAiConfigured={Boolean(health?.openai.configured)}
                view={view}
                onContinue={() => setStage("talk")}
                onDraftExport={exportDraft}
                onFinalExport={exportVerified}
                onRemember={rememberAnswer}
                onReset={resetSession}
                onResolve={resolveVerificationFinding}
                onVerify={runFinalVerification}
              />
            )}
          </section>

          <aside className="status-card" aria-label="Form status">
            <p className="status-label">Today’s form</p>
            {view ? (
              <>
                <h2>{view.session.form.title}</h2>
                <p>{view.session.form.source.fileName}</p>
                <div className="progress-copy">
                  <strong>{view.summary.completionPercent}%</strong>
                  <span>{view.summary.answeredFields} of {view.summary.totalFields} answered</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Form completion"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={view.summary.completionPercent}
                >
                  <span style={{ width: `${view.summary.completionPercent}%` }} />
                </div>
                <dl className="status-facts">
                  <div><dt>Required left</dt><dd>{view.summary.requiredOpen}</dd></div>
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
                <h2>{compilation.form?.title || "Uploaded document"}</h2>
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
              {health?.openai.configured ? "AI service connected" : "Sample mode ready"}
            </div>
          </aside>
        </div>

        <div className={error ? "notice error" : "notice"} role="status" aria-live="polite">
          {busy ? "Working…" : notice}
        </div>
      </main>

      <footer>
        <span>VocaForm</span>
        <span>Your answers stay under your control.</span>
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
        <p className="stage-kicker">Understand the form</p>
        <h2>Choose the form you want help with.</h2>
        <p className="stage-lead">
          Upload a PDF, Word document, or text file. GPT-5.6 Sol will find the questions, preserve their source evidence, and prepare a calm conversation.
        </p>
        <label className={openAiConfigured && !busy ? "upload-button" : "upload-button disabled"}>
          <span>Choose a form</span>
          <span aria-hidden="true">↑</span>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.text,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            disabled={!openAiConfigured || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onCompile(file);
              event.target.value = "";
            }}
          />
        </label>
        <p className="button-note">
          {openAiConfigured
            ? "PDF, DOCX, TXT, or Markdown · maximum 10 MB"
            : "Add OPENAI_API_KEY on the server to enable private document upload."}
        </p>
        <div className="sample-divider"><span>or explore without an API call</span></div>
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
      <h2>{view.session.form.title}</h2>
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
          suggestions={view.memory.suggestions}
          onApply={onApplyMemory}
        />
      )}
      <button type="button" className="primary-button" disabled={busy} onClick={onStart}>
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
      <h2>{form?.title || "This document needs another look."}</h2>
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
                <span>{section.title}</span>
                <small>{section.fields.length} {section.fields.length === 1 ? "question" : "questions"}</small>
              </summary>
              <ul>
                {section.fields.map((field) => (
                  <li key={field.id}>
                    <div>
                      <strong>{field.label}</strong>
                      <span>{field.required ? "Required" : "Optional"}</span>
                    </div>
                    <q>{field.evidence[0]?.text || "No source quote"}</q>
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
}

function TalkStage(props: TalkStageProps) {
  const { answer, busy, currentField, currentSectionTitle, view } = props;
  const voiceAvailable = props.realtime.supported;
  const [mode, setMode] = useState<"voice" | "type">(voiceAvailable ? "voice" : "type");
  const voiceActive = !["idle", "error", "complete"].includes(props.realtime.state);

  function selectMode(nextMode: "voice" | "type") {
    if (nextMode === "type") props.realtime.stop();
    setMode(nextMode);
  }

  if (!currentField) {
    return (
      <div className="stage-content complete-state">
        <div className="stage-icon success" aria-hidden="true">✓</div>
        <p className="stage-kicker">Conversation complete</p>
        <h2>You have reached the end of the form.</h2>
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
          suggestions={view.memory.suggestions}
          onApply={props.onApplyMemory}
          compact
        />
      )}
      <div className="question-meta">
        <span>{currentSectionTitle}</span>
        <span>{view.summary.openFields} open</span>
      </div>
      <div className="answer-mode" role="group" aria-label="How to answer">
        <button
          type="button"
          aria-pressed={mode === "voice"}
          disabled={!voiceAvailable}
          onClick={() => selectMode("voice")}
        >
          Voice
        </button>
        <button type="button" aria-pressed={mode === "type"} onClick={() => selectMode("type")}>
          Type
        </button>
      </div>

      {mode === "voice" ? (
        <div className={`voice-panel state-${props.realtime.state}`}>
          <div className="voice-presence" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <p className="voice-status" role="status" aria-live="polite">
            {voiceStateLabel(props.realtime.state)}
          </p>
          <h2>{props.realtime.assistantText || "Ready for a calm conversation?"}</h2>
          <p className="voice-guidance">
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
            {voiceActive ? "End voice conversation" : "Start voice conversation"}
          </button>
          <p className="privacy-copy">Your microphone is used only while this conversation is active.</p>
        </div>
      ) : (
        <div className="text-answer-panel">
          <p className="stage-kicker">One question at a time</p>
          <h2>{currentField.interviewPrompt}</h2>
          {currentField.examples.length > 0 && (
            <p className="question-help">For example: {currentField.examples.slice(0, 2).join(" · ")}</p>
          )}
          <form onSubmit={(event) => void props.onSubmit(event)}>
            <label htmlFor="answer">Your answer</label>
            <textarea
              id="answer"
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
        </div>
      )}
      <button type="button" className="text-button" onClick={props.onReview}>Review what I have so far</button>
    </div>
  );
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
  onDraftExport: () => Promise<void>;
  onFinalExport: () => Promise<void>;
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
  const { busy, view, onContinue, onDraftExport, onFinalExport, onRemember, onReset } = props;
  const answered = Object.values(view.session.answers).filter((answer) => answer.status === "answered");
  const blockers = view.verification.issues.filter((issue) => issue.severity === "blocker" && !issue.resolved);
  const ready = view.verification.readyForFinalExport;
  const semanticUnavailable = view.verification.semanticStatus === "unavailable";

  return (
    <div className="stage-content review-stage">
      <p className="stage-kicker">Review before sharing</p>
      <h2>{answered.length === 0 ? "Your draft is ready to begin." : `${answered.length} answers saved.`}</h2>
      <p className="stage-lead">
        {ready
          ? "Every blocking finding is resolved and the final verification passed."
          : blockers.length > 0
            ? `${blockers.length} ${blockers.length === 1 ? "finding needs" : "findings need"} attention before final export. You can still download a clearly marked draft.`
            : semanticUnavailable
              ? "The deterministic checks passed, but Sol verification is unavailable. Draft export remains available."
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
                ? "Configure the server-side OpenAI key to unlock verified export."
                : "Sol checks contradictions, ambiguity, and unsupported claims without editing the form."}</p>
        </div>
      </div>

      <VerificationPanel
        busy={busy}
        openAiConfigured={props.openAiConfigured}
        view={view}
        onResolve={props.onResolve}
        onVerify={props.onVerify}
      />

      <div className="export-plan" aria-label="Completed document format">
        <div>
          <strong>{exportKindLabel(view.exportPlan.kind)}</strong>
          <p>{view.exportPlan.description}</p>
        </div>
        <span>{view.exportPlan.sourceAvailable ? "Original preserved" : "Answer packet"}</span>
      </div>

      {answered.length > 0 && (
        <div className="answer-list">
          <h3>Saved answers</h3>
          {answered.slice(0, 4).map((item) => (
            <div key={item.fieldId} className="answer-row">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>{findFieldLabel(view, item.fieldId)}</strong>
                <p>{formatAnswer(item.normalizedAnswer)}</p>
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
                <strong>{item.fieldLabel}</strong>
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
          onRemember={onRemember}
        />
      )}

      <div className="review-actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={onContinue}>Continue answering</button>
        <button type="button" className="quiet-button" disabled={busy} onClick={() => void onDraftExport()}>
          Download draft DOCX <span aria-hidden="true">↓</span>
        </button>
        <button
          type="button"
          className="primary-button compact"
          disabled={busy || !ready}
          onClick={() => void onFinalExport()}
        >
          {view.exportPlan.buttonLabel} <span aria-hidden="true">↓</span>
        </button>
      </div>
      <button type="button" className="text-button danger" disabled={busy} onClick={() => void onReset()}>Close this form and start over</button>
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

  return (
    <section className="verification-panel" aria-labelledby="verification-title">
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
            return (
              <article key={issue.id} className={`finding-card ${issue.severity}`}>
                <div className="finding-copy">
                  <div className="finding-meta">
                    <span>{issue.severity === "blocker" ? "Needs you" : "Check"}</span>
                    <small>{issue.source === "model" ? "Sol verification" : "Deterministic check"}</small>
                  </div>
                  <strong>{verificationFieldLabel(props.view, issue.fieldId)}</strong>
                  <p>{issue.message}</p>
                  <small className="finding-evidence">Why: {issue.evidence}</small>
                </div>

                {isEditing && editableAction ? (
                  <form
                    className="finding-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!draftValue.trim()) return;
                      void props.onResolve(issue, editableAction, draftValue.trim(), targetFieldId).then(cancelEdit);
                    }}
                  >
                    {issueFieldIds.length > 1 && (
                      <label>
                        Answer to update
                        <select
                          value={targetFieldId}
                          onChange={(event) => {
                            setTargetFieldId(event.target.value);
                            setDraftValue(currentAnswerText(props.view, event.target.value));
                          }}
                        >
                          {issueFieldIds.map((fieldId) => (
                            <option key={fieldId} value={fieldId}>{verificationFieldLabel(props.view, fieldId)}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {editableAction === "answer" ? "Your answer" : "Corrected answer"}
                      <textarea
                        rows={3}
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="finding-actions">
                      <button type="button" disabled={props.busy} onClick={cancelEdit}>Cancel</button>
                      <button type="submit" disabled={props.busy || !draftValue.trim()}>Save explicitly</button>
                    </div>
                  </form>
                ) : (
                  <div className="finding-actions">
                    {editableAction && (
                      <button type="button" disabled={props.busy} onClick={() => beginEdit(issue, editableAction)}>
                        {editableAction === "answer" ? "Answer now" : "Correct"}
                      </button>
                    )}
                    {issue.actions.includes("confirm") && (
                      <button type="button" disabled={props.busy} onClick={() => void props.onResolve(issue, "confirm")}>
                        Confirm as written
                      </button>
                    )}
                    {issue.actions.includes("leave_blank") && (
                      <button className="leave-blank" type="button" disabled={props.busy} onClick={() => void props.onResolve(issue, "leave_blank")}>
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
  suggestions: MemorySuggestion[];
  onApply: (suggestion: MemorySuggestion) => Promise<void>;
}

function MemorySuggestions({ busy, compact = false, suggestions, onApply }: MemorySuggestionsProps) {
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
        {suggestions.map((suggestion) => (
          <article key={`${suggestion.fieldId}:${suggestion.claimId}`} className="memory-suggestion-card">
            <div>
              <span>{suggestion.fieldLabel}</span>
              <strong>{formatValue(suggestion.value)}</strong>
              <small>For {suggestion.subject} · remembered from {suggestion.sourceFormTitle}</small>
            </div>
            <button type="button" disabled={busy} onClick={() => void onApply(suggestion)}>
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
  onRemember: (fieldId: string, subject: string) => Promise<void>;
}

function RememberCandidates({ busy, candidates, onRemember }: RememberCandidatesProps) {
  return (
    <section className="remember-candidates" aria-label="Answers you can remember">
      <p className="stage-kicker">Save time next form</p>
      <h3>Would you like VocaForm to remember any of these?</h3>
      <p>Only stable contact details appear here. Nothing is stored unless you choose Remember.</p>
      <div className="memory-card-list">
        {candidates.map((candidate) => (
          <article key={candidate.fieldId} className="remember-candidate-card">
            <div>
              <span>{candidate.fieldLabel}</span>
              <strong>{formatValue(candidate.value)}</strong>
              <small>{candidate.reason}</small>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRemember(candidate.fieldId, candidate.subject)}
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
        <p className="memory-drawer-lead">
          These facts were saved only after you approved them. Correct or forget anything here at any time.
        </p>

        {props.candidates.length > 0 && (
          <RememberCandidates
            busy={props.busy}
            candidates={props.candidates}
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
                    <span>{claim.sourceFieldLabel || humanizeMemoryKey(claim.key)}</span>
                    <small>{claim.subject}</small>
                  </div>
                  <span className="approved-badge">Approved</span>
                </div>
                {editingClaimId === claim.id ? (
                  <form onSubmit={(event) => void submitCorrection(event, claim.id)}>
                    <label htmlFor={`memory-${claim.id}`}>Correct remembered value</label>
                    <input
                      id={`memory-${claim.id}`}
                      value={draftValue}
                      onChange={(event) => setDraftValue(event.target.value)}
                      disabled={props.busy}
                      autoFocus
                    />
                    <div className="claim-actions">
                      <button type="button" disabled={props.busy} onClick={() => setEditingClaimId(null)}>Cancel</button>
                      <button type="submit" disabled={props.busy || !draftValue.trim()}>Save correction</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong className="claim-value">{formatValue(claim.value)}</strong>
                    <p>
                      Remembered from {claim.sourceFormTitle || claim.sourceFormId} on{" "}
                      <time dateTime={claim.confirmedAt ?? undefined}>{formatDate(claim.confirmedAt)}</time>.
                    </p>
                    <div className="claim-actions">
                      <button type="button" disabled={props.busy} onClick={() => beginCorrection(claim)}>Correct</button>
                      <button type="button" className="forget" disabled={props.busy} onClick={() => void props.onForget(claim.id)}>Forget</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
        <p className="memory-storage-note">Stored only in this VocaForm work directory. Conversation history is never used as memory.</p>
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
  if (!configured || view.verification.semanticStatus === "unavailable") return "Sol verification is unavailable";
  if (view.verification.semanticStatus === "passed") return "Sol verification passed";
  if (view.verification.semanticStatus === "findings") return "Sol found details for you to review";
  if (view.verification.semanticStatus === "error") return "Sol verification needs another try";
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
    return "Configure the server-side OpenAI key to check contradictions, ambiguity, and unsupported claims. Draft export remains available.";
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
  return "Sol reads the saved answers and their original wording, then reports findings without editing the session.";
}

function verificationNotice(view: SessionView): string {
  const blockers = view.verification.issues.filter((issue) => issue.severity === "blocker" && !issue.resolved);
  if (blockers.length > 0) {
    return `${blockers.length} ${blockers.length === 1 ? "finding needs" : "findings need"} your attention.`;
  }
  if (view.verification.semanticStatus === "unavailable") {
    return "Deterministic checks passed, but Sol verification is unavailable.";
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
