import { deliveryTargetsForField, listFormFields } from "../domain/form_definition";
import { formDefinitionSchema } from "../domain/schemas";
import { createFormSession, verifySession } from "../domain/session";
import { loadGoldenCompilerFixtures } from "./golden_fixtures";
import { buildWebFormDomainFixture } from "./web_form_domain_fixture";

const form = buildWebFormDomainFixture();
const fields = listFormFields(form);
const supportedFields = fields.filter((field) => field.support.status === "supported");
const unsupportedFields = fields.filter((field) => field.support.status === "unsupported");
const verification = verifySession(createFormSession(form));
const unsupportedBlockers = verification.issues.filter((issue) => issue.kind === "unsupported_control");
const documentFixtures = await loadGoldenCompilerFixtures();
const documentParity = documentFixtures.map((fixture) => ({
  id: fixture.id,
  exact: JSON.stringify(formDefinitionSchema.parse(fixture.form)) === JSON.stringify(fixture.form)
}));

assert(fields.length === form.source.revision.questionCount, "The revision question count drifted.");
assert(form.flow.pages.length === form.source.revision.pageCount, "The revision page count drifted.");
assert(supportedFields.every((field) => deliveryTargetsForField(field).length > 0),
  "A supported field has no delivery target.");
assert(unsupportedBlockers.length === unsupportedFields.length,
  "An unsupported control did not produce a blocker.");
assert(documentParity.every((result) => result.exact), "A document fixture changed during canonical parsing.");

console.log(JSON.stringify({
  passed: true,
  webForm: {
    provider: form.source.provider,
    questionCount: fields.length,
    pageCount: form.flow.pages.length,
    branchEdgeCount: form.flow.edges.filter((edge) => edge.kind === "conditional").length,
    supportedControlCount: supportedFields.length,
    supportedDeliveryCoveragePercent: percent(
      supportedFields.filter((field) => deliveryTargetsForField(field).length > 0).length,
      supportedFields.length
    ),
    unsupportedControlCount: unsupportedFields.length,
    unsupportedBlockerCoveragePercent: percent(unsupportedBlockers.length, unsupportedFields.length),
    fieldTypes: Object.fromEntries([...new Set(fields.map((field) => field.type))]
      .map((type) => [type, fields.filter((field) => field.type === type).length]))
  },
  documentParity
}, null, 2));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function percent(value: number, total: number): number {
  return total === 0 ? 100 : Math.round(value / total * 100);
}
