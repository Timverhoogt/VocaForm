import { documentDeliveryPlanSchema, type DocumentDeliveryPlan, type FormSession } from "../domain/schemas";
import {
  buildDocumentExportPlan,
  renderDraftDocument,
  renderVerifiedDocument,
  type RenderedDocument,
  type SourceDocument
} from "./document_renderer";

export { DocumentRenderError } from "./document_renderer";
export type { RenderedDocument, SourceDocument } from "./document_renderer";

export function buildDocumentDeliveryPlan(
  session: FormSession,
  source: SourceDocument | null
): DocumentDeliveryPlan {
  return documentDeliveryPlanSchema.parse({
    channel: "document",
    ...buildDocumentExportPlan(session, source)
  });
}

export function deliverDraftDocument(session: FormSession): RenderedDocument {
  return renderDraftDocument(session);
}

export function deliverVerifiedDocument(
  session: FormSession,
  source: SourceDocument | null
): Promise<RenderedDocument> {
  return renderVerifiedDocument(session, source);
}
