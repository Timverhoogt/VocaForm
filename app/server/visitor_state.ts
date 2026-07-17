import type { SourceDocument } from "../adapters/document_renderer";
import type { WebFormBrowserPreparationRuntime } from "../adapters/web_form_browser_session";
import { createEmptyMemoryVault } from "../domain/memory";
import type {
  FormSession,
  MemoryVault,
  WebFormFallbackReason,
  WebFormPreparation
} from "../domain/schemas";
import type { SemanticVerificationRun } from "../domain/verification";
import type { CompilationResult } from "../shared/api";
import { InterviewToolExecutor } from "./interview_tools";

export const VISITOR_COOKIE_NAME = "vocaform_visitor";
export const PUBLIC_VISITOR_TTL_MS = 2 * 60 * 60 * 1_000;

export interface VisitorState {
  session: FormSession | null;
  compilation: CompilationResult | null;
  compilationSource: { compilationId: string; document: SourceDocument } | null;
  sessionSource: SourceDocument | null;
  webForm: {
    access: "public" | "external";
    handoffUrl: string;
    warnings: string[];
    nativePreparationFallbackReason: WebFormFallbackReason | null;
    preparation: WebFormPreparation;
    browserSession: WebFormBrowserPreparationRuntime | null;
  } | null;
  semanticVerification: SemanticVerificationRun | null;
  memoryVault: MemoryVault;
  interviewToolExecutor: InterviewToolExecutor;
}

interface VisitorStateEntry {
  state: VisitorState;
  lastAccessedAt: number;
}

interface VisitorStateRegistryOptions {
  publicDemo: boolean;
  localMemoryVault: MemoryVault;
  maximumPublicVisitors?: number;
  publicVisitorTtlMs?: number;
  onDiscard?: (state: VisitorState) => void;
}

export interface ResolvedVisitorState {
  id: string;
  state: VisitorState;
  created: boolean;
}

export class VisitorStateRegistry {
  private readonly localState: VisitorState;
  private readonly publicStates = new Map<string, VisitorStateEntry>();
  private readonly maximumPublicVisitors: number;
  private readonly publicVisitorTtlMs: number;

  constructor(private readonly options: VisitorStateRegistryOptions) {
    this.localState = createVisitorState(options.localMemoryVault);
    this.maximumPublicVisitors = options.maximumPublicVisitors ?? 100;
    this.publicVisitorTtlMs = options.publicVisitorTtlMs ?? PUBLIC_VISITOR_TTL_MS;
  }

  resolve(requestedId: string | null, now = Date.now()): ResolvedVisitorState {
    if (!this.options.publicDemo) {
      return { id: "local", state: this.localState, created: false };
    }

    this.prune(now);
    const id = isVisitorId(requestedId) ? requestedId : crypto.randomUUID();
    const existing = this.publicStates.get(id);
    if (existing) {
      existing.lastAccessedAt = now;
      return { id, state: existing.state, created: false };
    }

    this.evictOldestIfFull();
    const state = createVisitorState(createEmptyMemoryVault(new Date(now)));
    this.publicStates.set(id, { state, lastAccessedAt: now });
    return { id, state, created: true };
  }

  activePublicVisitors(): number {
    return this.publicStates.size;
  }

  private prune(now: number): void {
    for (const [id, entry] of this.publicStates) {
      if (now - entry.lastAccessedAt >= this.publicVisitorTtlMs) {
        this.publicStates.delete(id);
        this.options.onDiscard?.(entry.state);
      }
    }
  }

  private evictOldestIfFull(): void {
    if (this.publicStates.size < this.maximumPublicVisitors) return;
    let oldest: { id: string; lastAccessedAt: number } | null = null;
    for (const [id, entry] of this.publicStates) {
      if (!oldest || entry.lastAccessedAt < oldest.lastAccessedAt) {
        oldest = { id, lastAccessedAt: entry.lastAccessedAt };
      }
    }
    if (oldest) {
      const discarded = this.publicStates.get(oldest.id);
      this.publicStates.delete(oldest.id);
      if (discarded) this.options.onDiscard?.(discarded.state);
    }
  }
}

export function visitorIdFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === VISITOR_COOKIE_NAME) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function publicVisitorCookie(id: string, secure: boolean): string {
  const attributes = [
    `${VISITOR_COOKIE_NAME}=${encodeURIComponent(id)}`,
    "Path=/",
    `Max-Age=${Math.floor(PUBLIC_VISITOR_TTL_MS / 1_000)}`,
    "HttpOnly",
    "SameSite=Strict"
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function createVisitorState(memoryVault: MemoryVault): VisitorState {
  return {
    session: null,
    compilation: null,
    compilationSource: null,
    sessionSource: null,
    webForm: null,
    semanticVerification: null,
    memoryVault,
    interviewToolExecutor: new InterviewToolExecutor()
  };
}

function isVisitorId(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
