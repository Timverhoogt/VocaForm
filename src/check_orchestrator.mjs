import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialState, loadJson } from "./form_state.mjs";
import {
  buildRuleBasedInterviewDecision,
  decideInterviewOrchestration
} from "./orchestrator.mjs";
import { cleanTranscriptText, isInterviewControlOnly } from "./transcript_cleanup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = await loadJson(path.join(root, "data", "example_entreeformulier.schema.json"));
const profile = await loadJson(path.join(root, "data", "family_profile.example.json"));
const state = createInitialState(schema, profile);
const transcript = "Het kind speelt graag buiten en heeft geen allergieen.";

const localDecision = buildRuleBasedInterviewDecision({ formSchema: schema, state, transcript });
assert.equal(localDecision.action, "extract_answers");
assert.equal(localDecision.should_clear_transcript, true);

assert.equal(cleanTranscriptText("Geefsvoorbeelden"), "geef wat voorbeelden");
assert.equal(isInterviewControlOnly("Geefsvoorbeelden"), true);

const localControlDecision = buildRuleBasedInterviewDecision({
  formSchema: schema,
  state,
  transcript: "Geefsvoorbeelden"
});
assert.equal(localControlDecision.action, "ask_followup");
assert.equal(localControlDecision.should_clear_transcript, true);
assert.ok(localControlDecision.user_message.includes("Vertel"));

const localResult = await decideInterviewOrchestration({
  config: { openRouterApiKey: "", openRouterModel: "local" },
  formSchema: schema,
  state,
  transcript: "",
  useOpenRouter: false,
  requestStructuredJson: async () => {
    throw new Error("network should not be used for local orchestration checks");
  }
});
assert.equal(localResult.source, "local_rules");
assert.equal(localResult.decision.action, "ask_next_field");
assert.ok(localResult.decision.target_field_id);

const mockedResult = await decideInterviewOrchestration({
  config: { openRouterApiKey: "test", openRouterModel: "mock-model" },
  formSchema: schema,
  state,
  transcript,
  requestStructuredJson: async () => ({
    data: {
      action: "extract_answers",
      target_field_id: "not_an_open_field",
      user_message: "Ik verwerk het transcript.",
      rationale: "Transcript bevat mogelijke antwoorden.",
      confidence: 4,
      should_clear_transcript: false
    },
    raw: { id: "mock" }
  })
});
assert.equal(mockedResult.source, "openrouter");
assert.equal(mockedResult.decision.action, "extract_answers");
assert.equal(mockedResult.decision.target_field_id, null);
assert.equal(mockedResult.decision.confidence, 1);
assert.equal(mockedResult.decision.should_clear_transcript, true);

const mockedControlResult = await decideInterviewOrchestration({
  config: { openRouterApiKey: "test", openRouterModel: "mock-model" },
  formSchema: schema,
  state,
  transcript: "Geefsvoorbeelden",
  requestStructuredJson: async () => ({
    data: {
      action: "extract_answers",
      target_field_id: null,
      user_message: "Ik verwerk het transcript.",
      rationale: "Model probeerde te extraheren.",
      confidence: 1,
      should_clear_transcript: false
    },
    raw: { id: "mock-control" }
  })
});
assert.equal(mockedControlResult.decision.action, "ask_followup");
assert.equal(mockedControlResult.decision.should_clear_transcript, true);
assert.ok(mockedControlResult.decision.target_field_id);

console.log(JSON.stringify({
  ok: true,
  checks: [
    "local extract decision",
    "transcript artifact cleanup",
    "control-only transcript handling",
    "local no-network fallback",
    "structured decision normalization",
    "control-only model override"
  ]
}, null, 2));
