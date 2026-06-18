let session = null;
let selectedFieldId = null;
let recognition = null;
let listening = false;

const formTitle = document.querySelector("#formTitle");
const statusLine = document.querySelector("#statusLine");
const requiredOpen = document.querySelector("#requiredOpen");
const totalOpen = document.querySelector("#totalOpen");
const modelStatus = document.querySelector("#modelStatus");
const meterFill = document.querySelector("#meterFill");
const fieldList = document.querySelector("#fieldList");
const profileStatus = document.querySelector("#profileStatus");
const profileEditor = document.querySelector("#profileEditor");
const profileSaveButton = document.querySelector("#profileSaveButton");
const reviewStatus = document.querySelector("#reviewStatus");
const blockerCount = document.querySelector("#blockerCount");
const warningCount = document.querySelector("#warningCount");
const reviewList = document.querySelector("#reviewList");
const sectionLabel = document.querySelector("#sectionLabel");
const fieldLabel = document.querySelector("#fieldLabel");
const questionText = document.querySelector("#questionText");
const answerText = document.querySelector("#answerText");
const recognitionStatus = document.querySelector("#recognitionStatus");
const savedAnswer = document.querySelector("#savedAnswer");
const useOpenRouter = document.querySelector("#useOpenRouter");
const manualSaveButton = document.querySelector("#manualSaveButton");
const skipButton = document.querySelector("#skipButton");
const speakButton = document.querySelector("#speakButton");
const listenButton = document.querySelector("#listenButton");
const saveButton = document.querySelector("#saveButton");
const renderDraftButton = document.querySelector("#renderDraftButton");
const renderFinalButton = document.querySelector("#renderFinalButton");
const resetButton = document.querySelector("#resetButton");
const downloadLink = document.querySelector("#downloadLink");

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

function render() {
  formTitle.textContent = session.form.title;
  requiredOpen.textContent = session.summary.required_fields_open;
  totalOpen.textContent = session.summary.total_interview_fields_open;
  modelStatus.textContent = session.has_openrouter_key ? "aan" : "lokaal";
  profileStatus.textContent = session.profile.child_name || `${session.profile.prefilled_fields} velden`;
  reviewStatus.textContent = session.review.ready_for_final_export ? "final-ready" : "concept";
  reviewStatus.className = session.review.ready_for_final_export ? "ready" : "draft";
  blockerCount.textContent = `${session.review.blockers.length} blockers`;
  warningCount.textContent = `${session.review.warnings.length} warnings`;
  renderFinalButton.disabled = !session.review.ready_for_final_export;
  useOpenRouter.checked = session.has_openrouter_key;
  useOpenRouter.disabled = !session.has_openrouter_key;

  const total = session.fields.length;
  const open = session.summary.total_interview_fields_open;
  const done = Math.max(0, total - open);
  meterFill.style.width = `${Math.round((done / total) * 100)}%`;
  statusLine.textContent = `${done}/${total} velden ingevuld`;

  const blockerIds = new Set(session.review.blockers.map((item) => item.field_id));
  const warningIds = new Set(session.review.warnings.map((item) => item.field_id));

  reviewList.replaceChildren(...[...session.review.blockers, ...session.review.warnings].slice(0, 8).map((item) => {
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
  }));

  fieldList.replaceChildren(...session.fields.map((field) => {
    const answer = answerFor(field.id);
    const button = document.createElement("button");
    button.className = `field-row ${field.id === selectedFieldId ? "active" : ""} ${answer.status === "answered" || answer.status === "skipped" ? "done" : ""} ${blockerIds.has(field.id) ? "blocked" : ""} ${warningIds.has(field.id) ? "warn" : ""}`;
    button.textContent = `${answer.status === "answered" ? "OK " : answer.status === "skipped" ? "-- " : ""}${field.label}`;
    button.title = field.section_title;
    button.addEventListener("click", () => selectField(field.id));
    return button;
  }));

  const field = currentField();
  if (!field) {
    sectionLabel.textContent = "Klaar";
    fieldLabel.textContent = "Alle velden zijn verwerkt";
    questionText.textContent = "";
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
  selectedFieldId = field.id;
  const answer = answerFor(field.id);
  answerText.value = answer.normalized_answer || answer.raw_answer || "";
  render();
  answerText.focus();
}

async function loadSession() {
  session = await api("/api/session");
  const profile = await api("/api/profile");
  profileEditor.value = JSON.stringify(profile.profile, null, 2);
  selectedFieldId = session.next_field?.id || session.fields[0]?.id || null;
  render();
}

function speakCurrentQuestion() {
  const field = currentField();
  if (!field || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(field.spoken_question || field.interview_prompt);
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
    recognitionStatus.textContent = "microfoon stil";
  };
  instance.onerror = (event) => {
    recognitionStatus.textContent = event.error || "spraakfout";
  };
  return instance;
}

function toggleListening() {
  if (!recognition) recognition = initRecognition();
  if (!recognition) return;
  if (listening) {
    recognition.stop();
    return;
  }
  listening = true;
  listenButton.classList.add("listening");
  recognition.start();
}

async function saveAnswer() {
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
  session = result.session;
  selectedFieldId = session.next_field?.id || field.id;
  answerText.value = "";
  downloadLink.hidden = true;
  render();
  speakCurrentQuestion();
}

async function saveManualAnswer(status = "answered") {
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
  session = result.session;
  selectedFieldId = status === "skipped" ? (session.next_field?.id || field.id) : field.id;
  if (status === "skipped") answerText.value = "";
  downloadLink.hidden = true;
  render();
}

async function renderDocx(final) {
  try {
    const result = await api("/api/render", {
      method: "POST",
      body: JSON.stringify({ mode: "in-place", final })
    });
    session.review = result.review;
    statusLine.textContent = `DOCX gemaakt (${result.export_kind}): ${result.output_file}`;
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
  answerText.value = "";
  downloadLink.hidden = true;
  render();
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
  session = result.session;
  profileEditor.value = JSON.stringify(result.profile, null, 2);
  selectedFieldId = session.next_field?.id || session.fields[0]?.id || null;
  answerText.value = "";
  downloadLink.hidden = true;
  render();
}

speakButton.addEventListener("click", speakCurrentQuestion);
listenButton.addEventListener("click", toggleListening);
saveButton.addEventListener("click", saveAnswer);
manualSaveButton.addEventListener("click", () => saveManualAnswer("answered"));
skipButton.addEventListener("click", () => saveManualAnswer("skipped"));
renderDraftButton.addEventListener("click", () => renderDocx(false));
renderFinalButton.addEventListener("click", () => renderDocx(true));
resetButton.addEventListener("click", resetSession);
profileSaveButton.addEventListener("click", saveProfile);

loadSession().catch((error) => {
  statusLine.textContent = error.message;
});
