import type {
  DeliveryTarget,
  DocumentFormDefinition,
  DocumentFormField,
  FormDefinition,
  FormField,
  FormSession,
  WebFormDefinition,
  WebFormField
} from "./schemas";

export type DocumentFormSession = Omit<FormSession, "form"> & {
  form: DocumentFormDefinition;
};

export function isWebFormDefinition(form: FormDefinition): form is WebFormDefinition {
  return "kind" in form.source && form.source.kind === "web_form";
}

export function isDocumentFormDefinition(form: FormDefinition): form is DocumentFormDefinition {
  return !isWebFormDefinition(form);
}

export function isWebFormField(field: FormField): field is WebFormField {
  return "deliveryTargets" in field;
}

export function isDocumentFormField(field: FormField): field is DocumentFormField {
  return "renderTargets" in field;
}

export function listFormFields(form: DocumentFormDefinition): DocumentFormField[];
export function listFormFields(form: WebFormDefinition): WebFormField[];
export function listFormFields(form: FormDefinition): FormField[];
export function listFormFields(form: FormDefinition): FormField[] {
  const fields: FormField[] = [];
  for (const section of form.sections) {
    for (const field of section.fields) fields.push(field);
  }
  return fields;
}

export function deliveryTargetsForField(field: FormField): DeliveryTarget[] {
  return isDocumentFormField(field) ? field.renderTargets : field.deliveryTargets;
}

export function sourceDisplayName(form: FormDefinition): string {
  return isDocumentFormDefinition(form)
    ? form.source.fileName
    : `${providerDisplayName(form.source.provider)} web form`;
}

export function assertDocumentFormSession(
  session: FormSession
): asserts session is DocumentFormSession {
  if (!isDocumentFormDefinition(session.form)) {
    throw new Error("The document delivery adapter cannot process a web-form session.");
  }
}

function providerDisplayName(provider: WebFormDefinition["source"]["provider"]): string {
  return provider === "google_forms" ? "Google Forms" : "Microsoft Forms";
}
