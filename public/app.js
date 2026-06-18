let session = null;
let selectedFieldId = null;
let recognition = null;
let listening = false;
let preferOpenRouter = true;
let interviewMode = "field";
let lastWholeExtraction = null;
let lastWholeOrchestration = null;
let realtimePeerConnection = null;
let realtimeDataChannel = null;
let realtimeMediaStream = null;
let realtimeAudioElement = null;
let realtimeConnected = false;
let realtimeConnecting = false;
let assistantTranscript = "";
let currentView = "interview";
let formLibrary = null;

const formTitle = document.querySelector("#formTitle");
const statusLine = document.querySelector("#statusLine");
const formsButton = document.querySelector("#formsButton");
const formsPage = document.querySelector("#formsPage");
const interviewView = document.querySelector("#interviewView");
const libraryImportButton = document.querySelector("#libraryImportButton");
const backToInterviewButton = document.querySelector("#backToInterviewButton");
const formsCapability = document.querySelector("#formsCapability");
const formsList = document.querySelector("#formsList");
const formsDownloadLink = document.querySelector("#formsDownloadLink");
const requiredOpen = document.querySelector("#requiredOpen");
const totalOpen = document.querySelector("#totalOpen");
const modelStatus = document.querySelector("#modelStatus");
const sourceKind = document.querySelector("#sourceKind");
const sourceStatus = document.querySelector("#sourceStatus");
const persistenceStatus = document.querySelector("#persistenceStatus");
const formImportInput = document.querySelector("#formImportInput");
const formImportButton = document.querySelector("#formImportButton");
const importStatus = document.querySelector("#importStatus");
const meterFill = document.querySelector("#meterFill");
const fieldList = document.querySelector("#fieldList");
const profileStatus = document.querySelector("#profileStatus");
const profileEditor = document.querySelector("#profileEditor");
const profileSaveButton = document.querySelector("#profileSaveButton");
const fieldModeButton = document.querySelector("#fieldModeButton");
const wholeModeButton = document.querySelector("#wholeModeButton");
const reviewStatus = document.querySelector("#reviewStatus");
const blockerCount = document.querySelector("#blockerCount");
const warningCount = document.querySelector("#warningCount");
const reviewList = document.querySelector("#reviewList");
const sectionLabel = document.querySelector("#sectionLabel");
const fieldLabel = document.querySelector("#fieldLabel");
const questionText = document.querySelector("#questionText");
const assistantText = document.querySelector("#assistantText");
const answerText = document.querySelector("#answerText");
const recognitionStatus = document.querySelector("#recognitionStatus");
const savedAnswer = document.querySelector("#savedAnswer");
const useOpenRouter = document.querySelector("#useOpenRouter");
const openRouterLabel = document.querySelector("#openRouterLabel");
const openRouterHint = document.querySelector("#openRouterHint");
const openRouterControl = useOpenRouter.closest(".switch-label");
const manualSaveButton = document.querySelector("#manualSaveButton");
const skipButton = document.querySelector("#skipButton");
const speakButton = document.querySelector("#speakButton");
const listenButton = document.querySelector("#listenButton");
const saveButton = document.querySelector("#saveButton");
const renderDraftButton = document.querySelector("#renderDraftButton");
const renderFinalButton = document.querySelector("#renderFinalButton");
const resetButton = document.querySelector("#resetButton");
const downloadLink = document.querySelector("#downloadLink");
const realtimeStatus = document.querySelector("#realtimeStatus");

const storagePrefix = "vocaform.v1";

function storageKey(...parts) {
  return [storagePrefix, ...parts.map((part) => encodeURIComponent(String(part)))].join(".");
}

function readLocalJson(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage is only a draft cache; the server store remains canonical.
  }
}

function removeLocalKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore browser storage failures.
  }
}

function formCacheId() {
  return session?.form?.id || "unknown-form";
}

function activeDraftScope() {
  if (!session) return null;
  if (isWholeFormMode()) return "whole";
  const field = currentField();
  return field?.id || null;
}

function draftKey(scope = activeDraftScope()) {
  if (!scope) return null;
  return storageKey("draft", formCacheId(), scope);
}

function readDraft(scope = activeDraftScope()) {
  const key = draftKey(scope);
  if (!key) return "";
  return readLocalJson(key, { text: "" })?.text || "";
}

function writeDraft() {
  const key = draftKey();
  if (!key) return;
  const text = answerText.value;
  if (!text.trim()) {
    removeLocalKey(key);
    return;
  }
  writeLocalJson(key, {
    text,
    updated_at: new Date().toISOString()
  });
}

function clearDraft(scope = activeDraftScope()) {
  const key = draftKey(scope);
  if (key) removeLocalKey(key);
}

function clearFormDrafts(formId = formCacheId()) {
  const prefix = storageKey("draft", formId);
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // Ignore browser storage failures.
  }
}

function readUiCache() {
  return readLocalJson(storageKey("ui", formCacheId()), {});
}

function writeUiCache() {
  if (!session) return;
  writeLocalJson(storageKey("ui", formCacheId()), {
    selected_field_id: selectedFieldId,
    interview_mode: interviewMode,
    prefer_openrouter: preferOpenRouter,
    updated_at: new Date().toISOString()
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function answerFor(fieldId) {
  return session.state.interview_answers[fieldId];
}

function currentField() {
  return session.fields.find((field) => field.id === selectedFieldId) || session.next_field;
}

function isWholeFormMode() {
  return interviewMode === "whole";
}

function openInterviewFields() {
  return session.fields.filter((field) => {
    const answer = answerFor(field.id);
    return answer?.status === "unanswered" || answer?.status === "needs_followup";
  });
}

function isRealtimeAvailable() {
  return Boolean(session?.has_openai_realtime_key);
}

function isRealtimeOpen() {
  return realtimeConnected && realtimeDataChannel?.readyState === "open";
}

function buildRealtimeFieldPrompt(reason = "start") {
  const field = currentField();
  if (!field) {
    return "Het formulier is afgerond. Rond vriendelijk af en leg uit dat de gebruiker de finale DOCX kan maken als de review klaar is.";
  }

  const examples = field.examples?.length ? field.examples.join("; ") : "geen voorbeelden";
  return [
    `Context voor de huidige formulier-vraag (${reason}).`,
    `Sectie: ${field.section_title}.`,
    `Label: ${field.label}.`,
    `Vraag: ${field.interview_prompt}.`,
    `Voorbeelden die je mag noemen als hulp, niet als feiten: ${examples}.`,
    "Vraag dit ontspannen in het Nederlands.",
    "Als de gebruiker aarzelt, herformuleer of geef maximaal drie voorbeelden.",
    "Als het antwoord voldoende lijkt, vat kort samen en zeg dat de gebruiker op Opslaan kan klikken."
  ].join("\n");
}

function buildRealtimeWholeFormPrompt(reason = "start") {
  const fields = openInterviewFields();
  if (!fields.length) {
    return "Alle open velden zijn verwerkt. Rond vriendelijk af en leg uit dat de gebruiker de finale DOCX kan maken als de review klaar is.";
  }

  const fieldLines = fields.map((field, index) => {
    const examples = field.examples?.length ? field.examples.join("; ") : "geen voorbeelden";
    return [
      `${index + 1}. ${field.section_title} / ${field.label}`,
      `   Veld-id: ${field.id}`,
      `   Vraag: ${field.interview_prompt}`,
      `   Voorbeelden die je mag noemen als hulp, niet als feiten: ${examples}`
    ].join("\n");
  });

  return [
    `Context voor een volledig formulierinterview (${reason}).`,
    "Voer nu een doorlopend Nederlands interview voor alle open velden hieronder.",
    "Vraag de velden in volgorde, een vraag tegelijk.",
    "Vraag kort door wanneer een antwoord te vaag is voor het formulier.",
    "Ga na een bruikbaar antwoord vanzelf door naar het volgende veld.",
    "Vraag de gebruiker niet om per veld op Opslaan te klikken.",
    "Wanneer alle velden besproken zijn, vat heel kort af en zeg dat het transcript verwerkt kan worden.",
    "",
    fieldLines.join("\n")
  ].join("\n");
}

function buildRealtimePrompt(reason = "start") {
  return isWholeFormMode()
    ? buildRealtimeWholeFormPrompt(reason)
    : buildRealtimeFieldPrompt(reason);
}

function sendRealtimeEvent(event) {
  if (!isRealtimeOpen()) return;
  realtimeDataChannel.send(JSON.stringify(event));
}

function promptRealtimeCurrentField(reason = "start") {
  if (!isRealtimeOpen()) return;
  assistantTranscript = "";
  assistantText.textContent = "";
  sendRealtimeEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: buildRealtimePrompt(reason)
        }
      ]
    }
  });
  sendRealtimeEvent({ type: "response.create" });
}

function appendAnswerTranscript(transcript) {
  const text = String(transcript || "").trim();
  if (!text) return;
  const existing = answerText.value.trim();
  answerText.value = existing ? `${existing}\n${text}` : text;
}

function fieldStatusLabel(answer, hasBlocker, hasWarning) {
  if (hasBlocker) return "Nodig";
  if (hasWarning) return "Check";
  if (answer?.status === "answered") return "Klaar";
  if (answer?.status === "skipped") return "Later";
  return "Open";
}

function renderOpenRouterControl() {
  const available = session.has_openrouter_key;
  if (isWholeFormMode() && available) preferOpenRouter = true;
  useOpenRouter.disabled = !available || isWholeFormMode();
  useOpenRouter.checked = available && preferOpenRouter;
  openRouterLabel.textContent = isWholeFormMode() ? "AI extractie" : "AI normaliseren";
  openRouterHint.textContent = available
    ? (isWholeFormMode() ? "AI regie actief" : (useOpenRouter.checked ? "OpenRouter aan" : "OpenRouter uit"))
    : "geen API key";
  openRouterControl.classList.toggle("unavailable", !available);
  openRouterControl.title = available
    ? (isWholeFormMode()
      ? "Gebruik OpenRouter om de volgende formulieractie te bepalen."
      : "Gebruik OpenRouter om het antwoord te structureren bij Opslaan.")
    : "Configureer OPENROUTER_API_KEY om AI-normalisatie te gebruiken.";
}

function renderRealtimeControl() {
  const available = isRealtimeAvailable();
  const details = session.openai_realtime || {};
  const listenLabel = listenButton.querySelector("span:last-child");
  modelStatus.textContent = available ? "realtime" : session.has_openrouter_key ? "tekst-AI" : "lokaal";
  realtimeStatus.textContent = available
    ? `${details.model || "realtime"} / ${details.voice || "voice"}`
    : "OpenAI Realtime uit";
  realtimeStatus.className = `realtime-status ${available ? "" : "off"}`;
  listenButton.title = available
    ? "AI interview starten of stoppen"
    : "Antwoord inspreken met de browser";
  listenButton.setAttribute("aria-label", listenButton.title);
  if (listenLabel) {
    if (!available) listenLabel.textContent = "Opnemen";
    else if (realtimeConnecting) listenLabel.textContent = "Connecting...";
    else if (realtimeConnected) listenLabel.textContent = "Stop AI Interview";
    else listenLabel.textContent = "Start AI Interview";
  }
}

function renderModeControls() {
  fieldModeButton.classList.toggle("active", !isWholeFormMode());
  wholeModeButton.classList.toggle("active", isWholeFormMode());
  fieldModeButton.setAttribute("aria-pressed", String(!isWholeFormMode()));
  wholeModeButton.setAttribute("aria-pressed", String(isWholeFormMode()));

  const saveLabel = saveButton.querySelector("span:last-child");
  saveButton.disabled = isWholeFormMode() && !session.has_openrouter_key;
  saveButton.title = isWholeFormMode()
    ? "Volledig transcript via AI regie verwerken"
    : "Antwoord opslaan";
  saveButton.setAttribute("aria-label", saveButton.title);
  if (saveLabel) saveLabel.textContent = isWholeFormMode() ? "Verwerken" : "Opslaan";

  manualSaveButton.hidden = isWholeFormMode();
  skipButton.hidden = isWholeFormMode();
}

function renderFormSource() {
  const source = session.form.source || {};
  const format = source.format ? source.format.toUpperCase() : "FORM";
  const filename = source.filename || session.form.id || "standaard";
  sourceKind.textContent = format;
  sourceStatus.textContent = filename;
  sourceStatus.title = session.form.schema_path || filename;
  persistenceStatus.textContent = session.persistence?.server_store_path ? "Server + draft cache" : "Server";
  persistenceStatus.title = session.persistence?.server_store_path || "";
  renderDraftButton.title = session.form.can_render_original_docx
    ? "Concept DOCX maken vanuit de bron"
    : "Concept antwoorden-DOCX maken";
  renderDraftButton.setAttribute("aria-label", renderDraftButton.title);
  renderFinalButton.title = session.form.can_render_original_docx
    ? "Finale DOCX maken vanuit de bron"
    : "Finale antwoorden-DOCX maken";
  renderFinalButton.setAttribute("aria-label", renderFinalButton.title);
}

function setView(view) {
  currentView = view === "forms" ? "forms" : "interview";
  formsPage.hidden = currentView !== "forms";
  interviewView.hidden = currentView === "forms";
  formsButton.classList.toggle("active-view", currentView === "forms");
  formsButton.setAttribute("aria-pressed", String(currentView === "forms"));
  if (currentView === "forms") loadFormsLibrary();
}

function formatSource(source) {
  const format = String(source?.format || "form").toUpperCase();
  const filename = source?.filename || "formulier";
  return `${format} · ${filename}`;
}

function progressStatus(form) {
  if (form.error) return { label: "Fout", className: "blocked" };
  if (form.progress?.ready_for_final_export) return { label: "Klaar", className: "ready" };
  return { label: `${form.progress?.blockers || 0} open`, className: "blocked" };
}

function createFormRow(form) {
  const row = document.createElement("article");
  row.className = `form-row ${form.is_active ? "active" : ""}`;
  row.dataset.formId = form.id;

  const status = progressStatus(form);
  const percent = form.progress?.percent ?? 0;
  const completed = form.progress?.completed_fields ?? 0;
  const total = form.progress?.total_fields ?? 0;
  const ready = Boolean(form.progress?.ready_for_final_export);
  const pdfAvailable = Boolean(form.exports?.pdf?.available);
  const pdfReason = form.exports?.pdf?.reason || "PDF export is niet beschikbaar.";

  row.innerHTML = `
    <div class="form-main">
      <div class="form-title-line">
        <span class="form-status-chip ${status.className}">${status.label}</span>
        <span class="form-title-text"></span>
      </div>
      <div class="form-source-line"></div>
    </div>
    <div class="form-progress">
      <span class="form-percent">${percent}%</span>
      <div class="form-progress-copy">
        <div class="form-progress-bar" aria-hidden="true">
          <div class="form-progress-fill" style="width: ${Math.max(0, Math.min(100, percent))}%"></div>
        </div>
        <div class="form-progress-meta">${completed}/${total} velden · ${form.progress?.blockers || 0} blockers · ${form.progress?.warnings || 0} warnings</div>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="form-action" data-action="open">${form.is_active ? "Open" : "Openen"}</button>
      <button type="button" class="form-action" data-action="export-docx" ${ready ? "" : "disabled"}>DOCX</button>
      <button type="button" class="form-action" data-action="export-pdf" ${ready && pdfAvailable ? "" : "disabled"}>PDF</button>
    </div>
  `;

  row.querySelector(".form-title-text").textContent = form.title || form.id;
  row.querySelector(".form-source-line").textContent = `${formatSource(form.source)}${form.is_active ? " · actief" : ""}`;
  row.querySelector('[data-action="export-docx"]').title = ready ? "Finale DOCX exporteren" : "Los eerst de blockers op";
  row.querySelector('[data-action="export-pdf"]').title = ready
    ? (pdfAvailable ? "Finale PDF exporteren" : pdfReason)
    : "Los eerst de blockers op";
  return row;
}

function renderFormsLibrary() {
  if (!formLibrary) {
    formsCapability.textContent = "Formulieren laden";
    formsList.replaceChildren();
    return;
  }

  formsCapability.textContent = formLibrary.office?.available
    ? `PDF export via ${formLibrary.office.version || formLibrary.office.command}`
    : "PDF export uit: LibreOffice/soffice niet gevonden";

  if (!formLibrary.forms.length) {
    const empty = document.createElement("div");
    empty.className = "form-empty";
    empty.textContent = "Nog geen formulieren. Importeer een DOCX, PDF of tekstbestand.";
    formsList.replaceChildren(empty);
    return;
  }

  formsList.replaceChildren(...formLibrary.forms.map(createFormRow));
}

async function loadFormsLibrary() {
  formsCapability.textContent = "Formulieren laden";
  formLibrary = await api("/api/forms");
  renderFormsLibrary();
}

async function openStoredForm(formId) {
  writeDraft();
  const result = await api("/api/forms/activate", {
    method: "POST",
    body: JSON.stringify({ form_id: formId })
  });
  session = result;
  const profile = await api("/api/profile");
  profileEditor.value = JSON.stringify(profile.profile, null, 2);
  selectedFieldId = session.next_field?.id || session.fields[0]?.id || null;
  answerText.value = readDraft(selectedFieldId) || "";
  formsDownloadLink.hidden = true;
  setView("interview");
  render();
}

async function exportStoredForm(formId, format) {
  formsCapability.textContent = `Export ${format.toUpperCase()} maken`;
  formsDownloadLink.hidden = true;
  try {
    const result = await api("/api/forms/export", {
      method: "POST",
      body: JSON.stringify({
        form_id: formId,
        format,
        final: true
      })
    });
    formsCapability.textContent = `${format.toUpperCase()} klaar: ${result.output_file}`;
    formsDownloadLink.href = result.download_url;
    formsDownloadLink.download = result.output_file;
    formsDownloadLink.textContent = `Download ${result.output_file}`;
    formsDownloadLink.hidden = false;
    await loadFormsLibrary();
  } catch (error) {
    formsCapability.textContent = error.message;
  }
}

function render() {
  formTitle.textContent = session.form.title;
  requiredOpen.textContent = session.summary.required_fields_open;
  totalOpen.textContent = session.summary.total_interview_fields_open;
  profileStatus.textContent = session.profile.child_name || `${session.profile.prefilled_fields} velden`;
  reviewStatus.textContent = session.review.ready_for_final_export ? "final-ready" : "concept";
  reviewStatus.className = session.review.ready_for_final_export ? "ready" : "draft";
  blockerCount.textContent = `${session.review.blockers.length} blockers`;
  warningCount.textContent = `${session.review.warnings.length} warnings`;
  renderFinalButton.disabled = !session.review.ready_for_final_export;
  renderOpenRouterControl();
  renderRealtimeControl();
  renderModeControls();
  renderFormSource();

  const total = session.fields.length;
  const open = session.summary.total_interview_fields_open;
  const done = Math.max(0, total - open);
  meterFill.style.width = `${Math.round((done / total) * 100)}%`;
  statusLine.textContent = `${done}/${total} velden ingevuld`;

  const blockerIds = new Set(session.review.blockers.map((item) => item.field_id));
  const warningIds = new Set(session.review.warnings.map((item) => item.field_id));

  const reviewNodes = [...session.review.blockers, ...session.review.warnings].slice(0, 8).map((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.label}: ${item.message}`;
    li.title = item.section_title || "";
    li.className = item.kind.includes("missing") || item.kind.includes("followup") || item.kind.includes("skipped") ? "blocker" : "warning";
    li.tabIndex = 0;
    li.addEventListener("click", () => selectField(item.field_id));
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") selectField(item.field_id);
    });
    return li;
  });

  if (!reviewNodes.length) {
    const li = document.createElement("li");
    li.className = "review-empty";
    li.textContent = "Geen aandachtspunten";
    reviewNodes.push(li);
  }

  reviewList.replaceChildren(...reviewNodes);

  fieldList.replaceChildren(...session.fields.map((field) => {
    const answer = answerFor(field.id);
    const hasBlocker = blockerIds.has(field.id);
    const hasWarning = warningIds.has(field.id);
    const statusLabel = fieldStatusLabel(answer, hasBlocker, hasWarning);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `field-row ${field.id === selectedFieldId ? "active" : ""} ${answer?.status === "answered" || answer?.status === "skipped" ? "done" : ""} ${hasBlocker ? "blocked" : ""} ${hasWarning ? "warn" : ""}`;
    if (field.id === selectedFieldId) button.setAttribute("aria-current", "step");
    button.setAttribute("aria-label", `${field.label}, ${field.section_title}, ${statusLabel}`);
    button.title = field.section_title;

    const status = document.createElement("span");
    status.className = "field-status";
    status.textContent = statusLabel;

    const label = document.createElement("span");
    label.className = "field-label-text";
    label.textContent = field.label;

    const section = document.createElement("span");
    section.className = "field-section-text";
    section.textContent = field.section_title;

    button.append(status, label, section);
    button.addEventListener("click", () => selectField(field.id));
    return button;
  }));

  if (isWholeFormMode()) {
    const openFields = openInterviewFields();
    sectionLabel.textContent = "Hele formulier";
    fieldLabel.textContent = openFields.length ? `${openFields.length} open velden` : "Alle velden zijn verwerkt";
    questionText.textContent = openFields.length
      ? openFields.slice(0, 4).map((field) => field.label).join(" / ")
      : "";
    assistantText.textContent = assistantTranscript;
    savedAnswer.textContent = lastWholeOrchestration?.decision?.user_message || (lastWholeExtraction
      ? `${lastWholeExtraction.answers.length} antwoorden verwerkt`
      : "");
    if (!answerText.value) answerText.value = readDraft("whole");
    return;
  }

  const field = currentField();
  if (!field) {
    sectionLabel.textContent = "Klaar";
    fieldLabel.textContent = "Alle velden zijn verwerkt";
    questionText.textContent = "";
    assistantText.textContent = "";
    answerText.value = "";
    savedAnswer.textContent = "";
    return;
  }

  selectedFieldId = field.id;
  const answer = answerFor(field.id);
  sectionLabel.textContent = field.section_title;
  fieldLabel.textContent = field.label;
  questionText.textContent = field.spoken_question || field.interview_prompt;
  savedAnswer.textContent = answer.normalized_answer || answer.follow_up_question || "";
}

function selectField(fieldId) {
  const field = session.fields.find((item) => item.id === fieldId);
  if (!field) return;
  writeDraft();
  interviewMode = "field";
  selectedFieldId = field.id;
  const answer = answerFor(field.id);
  answerText.value = readDraft(field.id) || answer.normalized_answer || answer.raw_answer || "";
  writeUiCache();
  render();
  answerText.focus();
  promptRealtimeCurrentField("veld gewijzigd");
}

async function loadSession() {
  session = await api("/api/session");
  const profile = await api("/api/profile");
  profileEditor.value = JSON.stringify(profile.profile, null, 2);
  const uiCache = readUiCache();
  preferOpenRouter = uiCache.prefer_openrouter ?? preferOpenRouter;
  interviewMode = uiCache.interview_mode === "whole" ? "whole" : "field";
  selectedFieldId = session.fields.some((field) => field.id === uiCache.selected_field_id)
    ? uiCache.selected_field_id
    : session.next_field?.id || session.fields[0]?.id || null;
  const selectedAnswer = selectedFieldId ? answerFor(selectedFieldId) : null;
  answerText.value = isWholeFormMode()
    ? readDraft("whole")
    : readDraft(selectedFieldId) || selectedAnswer?.normalized_answer || selectedAnswer?.raw_answer || "";
  render();
}

async function importFormFile(file) {
  if (!file) return;
  formImportButton.disabled = true;
  libraryImportButton.disabled = true;
  importStatus.textContent = "Importeren";
  if (currentView === "forms") formsCapability.textContent = "Formulier importeren";
  downloadLink.hidden = true;
  formsDownloadLink.hidden = true;

  try {
    const params = new URLSearchParams({ filename: file.name });
    const response = await fetch(`/api/forms/import?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Import mislukt: ${response.status}`);

    session = body.session;
    const profile = await api("/api/profile");
    profileEditor.value = JSON.stringify(profile.profile, null, 2);
    selectedFieldId = session.next_field?.id || session.fields[0]?.id || null;
    lastWholeExtraction = null;
    lastWholeOrchestration = null;
    answerText.value = "";
    importStatus.textContent = `${body.summary.fields} velden geimporteerd`;
    writeUiCache();
    if (currentView === "forms") {
      await loadFormsLibrary();
    } else {
      render();
      promptRealtimeCurrentField("nieuw formulier geimporteerd");
    }
  } catch (error) {
    importStatus.textContent = error.message;
    if (currentView === "forms") formsCapability.textContent = error.message;
  } finally {
    formImportButton.disabled = false;
    libraryImportButton.disabled = false;
    formImportInput.value = "";
  }
}

function speakCurrentQuestion() {
  if (isRealtimeOpen()) {
    promptRealtimeCurrentField("herhaal");
    return;
  }
  if (!("speechSynthesis" in window)) return;
  const field = currentField();
  if (!isWholeFormMode() && !field) return;
  window.speechSynthesis.cancel();
  const openFields = openInterviewFields();
  const text = isWholeFormMode()
    ? `We lopen ${openFields.length} open velden door. ${openFields[0]?.interview_prompt || ""}`.trim()
    : (field.spoken_question || field.interview_prompt);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "nl-NL";
  window.speechSynthesis.speak(utterance);
}

function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    recognitionStatus.textContent = "spraak niet beschikbaar";
    return null;
  }
  const instance = new SpeechRecognition();
  instance.lang = "nl-NL";
  instance.continuous = true;
  instance.interimResults = true;
  instance.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    if (finalText) answerText.value = `${answerText.value} ${finalText}`.trim();
    recognitionStatus.textContent = interimText || "luistert";
  };
  instance.onend = () => {
    listening = false;
    listenButton.classList.remove("listening");
    recognitionStatus.classList.remove("active");
    recognitionStatus.textContent = "microfoon stil";
  };
  instance.onerror = (event) => {
    recognitionStatus.classList.remove("active");
    recognitionStatus.textContent = event.error || "spraakfout";
  };
  return instance;
}

function handleRealtimeEvent(event) {
  if (event.type === "input_audio_buffer.speech_started") {
    recognitionStatus.textContent = "luistert live";
    recognitionStatus.classList.add("active");
    return;
  }

  if (event.type === "input_audio_buffer.speech_stopped") {
    recognitionStatus.textContent = "denkt mee";
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    appendAnswerTranscript(event.transcript);
    recognitionStatus.textContent = "antwoord gehoord";
    return;
  }

  if (event.type === "response.audio_transcript.delta" || event.type === "response.text.delta") {
    assistantTranscript += event.delta || "";
    assistantText.textContent = assistantTranscript;
    return;
  }

  if (event.type === "response.audio_transcript.done") {
    assistantTranscript = event.transcript || assistantTranscript;
    assistantText.textContent = assistantTranscript;
    recognitionStatus.textContent = "live gesprek";
    return;
  }

  if (event.type === "response.done") {
    recognitionStatus.textContent = "live gesprek";
    return;
  }

  if (event.type === "error") {
    recognitionStatus.textContent = event.error?.message || "Realtime fout";
    recognitionStatus.classList.remove("active");
  }
}

function stopRealtimeInterview() {
  if (realtimeDataChannel) {
    realtimeDataChannel.onclose = null;
    realtimeDataChannel.onmessage = null;
    if (realtimeDataChannel.readyState === "open" || realtimeDataChannel.readyState === "connecting") {
      realtimeDataChannel.close();
    }
  }

  if (realtimePeerConnection) {
    realtimePeerConnection.ontrack = null;
    realtimePeerConnection.close();
  }

  if (realtimeMediaStream) {
    realtimeMediaStream.getTracks().forEach((track) => track.stop());
  }

  realtimeDataChannel = null;
  realtimePeerConnection = null;
  realtimeMediaStream = null;
  if (realtimeAudioElement) realtimeAudioElement.remove();
  realtimeAudioElement = null;
  realtimeConnected = false;
  realtimeConnecting = false;
  listening = false;
  listenButton.disabled = false;
  listenButton.classList.remove("listening");
  recognitionStatus.classList.remove("active");
  recognitionStatus.textContent = "microfoon stil";
  render();
}

async function startRealtimeInterview() {
  if (realtimeConnected || realtimePeerConnection) return;
  if (!("RTCPeerConnection" in window) || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Realtime audio is niet beschikbaar in deze browser.");
  }

  realtimeConnecting = true;
  recognitionStatus.textContent = "microfoon vragen";
  assistantText.textContent = "AI interview wordt gestart.";
  listenButton.disabled = true;
  renderRealtimeControl();

  try {
    realtimePeerConnection = new RTCPeerConnection();
    realtimePeerConnection.onconnectionstatechange = () => {
      if (!realtimePeerConnection) return;
      if (realtimePeerConnection.connectionState === "connecting") recognitionStatus.textContent = "verbinden";
      if (realtimePeerConnection.connectionState === "connected") recognitionStatus.textContent = "live gesprek";
      if (["failed", "disconnected", "closed"].includes(realtimePeerConnection.connectionState)) {
        recognitionStatus.textContent = "verbinding gestopt";
      }
    };
    realtimeAudioElement = document.createElement("audio");
    realtimeAudioElement.autoplay = true;
    realtimeAudioElement.playsInline = true;
    realtimeAudioElement.hidden = true;
    document.body.append(realtimeAudioElement);
    realtimePeerConnection.ontrack = (event) => {
      realtimeAudioElement.srcObject = event.streams[0];
    };

    recognitionStatus.textContent = "microfoon open";
    realtimeMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    realtimeMediaStream.getAudioTracks().forEach((track) => {
      realtimePeerConnection.addTrack(track, realtimeMediaStream);
    });

    realtimeDataChannel = realtimePeerConnection.createDataChannel("oai-events");
    realtimeDataChannel.onopen = () => {
      realtimeConnected = true;
      realtimeConnecting = false;
      listening = true;
      listenButton.classList.add("listening");
      recognitionStatus.classList.add("active");
      recognitionStatus.textContent = "live gesprek";
      listenButton.disabled = false;
      render();
      promptRealtimeCurrentField("start");
    };
    realtimeDataChannel.onmessage = (message) => {
      try {
        handleRealtimeEvent(JSON.parse(message.data));
      } catch {
        // Realtime server events are expected to be JSON.
      }
    };
    realtimeDataChannel.onclose = () => {
      stopRealtimeInterview();
    };

    const offer = await realtimePeerConnection.createOffer();
    await realtimePeerConnection.setLocalDescription(offer);

    recognitionStatus.textContent = "AI verbinden";
    const sdpResponse = await fetch("/api/realtime/call", {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp
    });
    const answerSdp = await sdpResponse.text();
    if (!sdpResponse.ok) {
      let detail = answerSdp;
      try {
        detail = JSON.parse(answerSdp).error || detail;
      } catch {
        // Keep the raw response body when it is not JSON.
      }
      throw new Error(detail || `Realtime request failed: ${sdpResponse.status}`);
    }

    await realtimePeerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp
    });
  } catch (error) {
    stopRealtimeInterview();
    recognitionStatus.textContent = error.message;
    assistantText.textContent = error.message;
    throw error;
  } finally {
    listenButton.disabled = false;
    realtimeConnecting = false;
    renderRealtimeControl();
  }
}

function toggleBrowserRecognition() {
  if (!recognition) recognition = initRecognition();
  if (!recognition) return;
  if (listening) {
    recognition.stop();
    return;
  }
  listening = true;
  listenButton.classList.add("listening");
  recognitionStatus.classList.add("active");
  recognition.start();
}

function toggleListening() {
  if (!isRealtimeAvailable()) {
    toggleBrowserRecognition();
    return;
  }

  if (realtimeConnected || realtimePeerConnection) {
    stopRealtimeInterview();
    return;
  }

  startRealtimeInterview().catch((error) => {
    recognitionStatus.textContent = error.message;
    assistantText.textContent = error.message;
  });
}

async function saveAnswer() {
  if (isWholeFormMode()) {
    await saveWholeTranscript();
    return;
  }

  const field = currentField();
  if (!field) return;
  const result = await api("/api/answer", {
    method: "POST",
    body: JSON.stringify({
      field_id: field.id,
      transcript: answerText.value,
      use_openrouter: useOpenRouter.checked
    })
  });
  clearDraft(field.id);
  session = result.session;
  selectedFieldId = session.next_field?.id || field.id;
  answerText.value = "";
  downloadLink.hidden = true;
  writeUiCache();
  render();
  if (isRealtimeOpen()) promptRealtimeCurrentField("volgende vraag");
  else speakCurrentQuestion();
}

async function saveWholeTranscript() {
  if (!answerText.value.trim()) {
    statusLine.textContent = "Geen transcript om te verwerken";
    return;
  }

  if (!session.has_openrouter_key) {
    statusLine.textContent = "OpenRouter API key nodig voor AI regie";
    return;
  }

  saveButton.disabled = true;
  statusLine.textContent = "AI regie bepaalt de volgende stap";
  try {
    const result = await api("/api/interview/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        transcript: answerText.value,
        requested_action: "process_transcript",
        use_openrouter: useOpenRouter.checked
      })
    });
    session = result.session;
    lastWholeExtraction = result.extraction;
    lastWholeOrchestration = result.orchestration;
    if (result.orchestration.decision.should_clear_transcript) {
      clearDraft("whole");
      answerText.value = "";
    }
    selectedFieldId = result.orchestration.decision.target_field_id || session.next_field?.id || selectedFieldId;
    assistantTranscript = result.orchestration.decision.user_message;
    downloadLink.hidden = true;
    statusLine.textContent = result.orchestration.decision.action === "extract_answers"
      ? `Transcript verwerkt: ${result.extraction.answers.length} antwoorden`
      : result.orchestration.decision.user_message;
    render();
    if (isRealtimeOpen()) promptRealtimeCurrentField("open velden na verwerking");
  } catch (error) {
    statusLine.textContent = error.message;
    render();
  }
}

async function saveManualAnswer(status = "answered") {
  if (isWholeFormMode()) return;
  const field = currentField();
  if (!field) return;
  const result = await api("/api/answer/manual", {
    method: "POST",
    body: JSON.stringify({
      field_id: field.id,
      normalized_answer: answerText.value,
      raw_answer: answerText.value,
      status
    })
  });
  clearDraft(field.id);
  session = result.session;
  selectedFieldId = status === "skipped" ? (session.next_field?.id || field.id) : field.id;
  if (status === "skipped") answerText.value = "";
  downloadLink.hidden = true;
  writeUiCache();
  render();
  if (status === "skipped") {
    if (isRealtimeOpen()) promptRealtimeCurrentField("volgende vraag");
    else speakCurrentQuestion();
  }
}

async function renderDocx(final) {
  try {
    const result = await api("/api/render", {
      method: "POST",
      body: JSON.stringify({ mode: "in-place", final })
    });
    session.review = result.review;
    const label = result.mode === "generated" ? "Antwoorden-DOCX" : "DOCX";
    statusLine.textContent = `${label} gemaakt (${result.export_kind}): ${result.output_file}`;
    downloadLink.href = result.download_url;
    downloadLink.download = result.output_file;
    downloadLink.textContent = `Download ${result.output_file}`;
    downloadLink.hidden = false;
    render();
  } catch (error) {
    downloadLink.hidden = true;
    statusLine.textContent = error.message;
    await loadSession();
  }
}

async function resetSession() {
  session = await api("/api/reset", { method: "POST", body: "{}" });
  selectedFieldId = session.next_field?.id || session.fields[0]?.id || null;
  lastWholeExtraction = null;
  lastWholeOrchestration = null;
  clearFormDrafts();
  answerText.value = "";
  downloadLink.hidden = true;
  writeUiCache();
  render();
  promptRealtimeCurrentField("opnieuw gestart");
}

async function saveProfile() {
  let profile;
  try {
    profile = JSON.parse(profileEditor.value);
  } catch (error) {
    profileStatus.textContent = "JSON fout";
    return;
  }

  const result = await api("/api/profile", {
    method: "PUT",
    body: JSON.stringify({ profile })
  });
  clearFormDrafts();
  session = result.session;
  profileEditor.value = JSON.stringify(result.profile, null, 2);
  selectedFieldId = session.next_field?.id || session.fields[0]?.id || null;
  lastWholeExtraction = null;
  lastWholeOrchestration = null;
  answerText.value = "";
  downloadLink.hidden = true;
  render();
  promptRealtimeCurrentField("profiel bijgewerkt");
}

function setInterviewMode(mode) {
  writeDraft();
  interviewMode = mode === "whole" ? "whole" : "field";
  if (!isWholeFormMode()) {
    const field = currentField();
    const answer = field ? answerFor(field.id) : null;
    answerText.value = readDraft(field?.id) || answer?.normalized_answer || answer?.raw_answer || "";
  } else {
    answerText.value = readDraft("whole") || "";
  }
  writeUiCache();
  render();
  promptRealtimeCurrentField("modus gewijzigd");
}

fieldModeButton.addEventListener("click", () => setInterviewMode("field"));
wholeModeButton.addEventListener("click", () => setInterviewMode("whole"));
formImportButton.addEventListener("click", () => formImportInput.click());
libraryImportButton.addEventListener("click", () => formImportInput.click());
formImportInput.addEventListener("change", () => importFormFile(formImportInput.files[0]));
formsButton.addEventListener("click", () => setView("forms"));
backToInterviewButton.addEventListener("click", () => setView("interview"));
formsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest(".form-row");
  const formId = row?.dataset.formId;
  if (!formId) return;
  if (button.dataset.action === "open") {
    openStoredForm(formId).catch((error) => {
      formsCapability.textContent = error.message;
    });
  }
  if (button.dataset.action === "export-docx") {
    exportStoredForm(formId, "docx");
  }
  if (button.dataset.action === "export-pdf") {
    exportStoredForm(formId, "pdf");
  }
});
answerText.addEventListener("input", writeDraft);
speakButton.addEventListener("click", speakCurrentQuestion);
listenButton.addEventListener("click", toggleListening);
saveButton.addEventListener("click", saveAnswer);
manualSaveButton.addEventListener("click", () => saveManualAnswer("answered"));
skipButton.addEventListener("click", () => saveManualAnswer("skipped"));
renderDraftButton.addEventListener("click", () => renderDocx(false));
renderFinalButton.addEventListener("click", () => renderDocx(true));
resetButton.addEventListener("click", resetSession);
profileSaveButton.addEventListener("click", saveProfile);
useOpenRouter.addEventListener("change", () => {
  preferOpenRouter = useOpenRouter.checked;
  writeUiCache();
  renderOpenRouterControl();
});

loadSession().catch((error) => {
  statusLine.textContent = error.message;
});
