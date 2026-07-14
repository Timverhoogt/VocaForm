import {
  semanticVerificationOutputSchema,
  type FormSession,
  type SemanticVerificationOutput
} from "../domain/schemas";
import type { AppConfig } from "./config";
import { buildFinalVerifierRequest } from "./final_verifier_request";
import { createOpenAiResponse } from "./openai_client.mjs";

export interface FinalVerifierCallResult {
  output: SemanticVerificationOutput;
  responseId: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

type ResponseFactory = (apiKey: string, request: Record<string, unknown>) => Promise<unknown>;

export class OpenAiFinalVerifier {
  constructor(
    private readonly config: AppConfig,
    private readonly responseFactory: ResponseFactory = createOpenAiResponse
  ) {
    if (!config.openAiApiKey) throw new Error("OPENAI_API_KEY is required for final verification.");
  }

  async verify(
    session: FormSession,
    mode: "standard" | "pro" = this.config.openAiVerificationReasoningMode
  ): Promise<FinalVerifierCallResult> {
    const response = await this.responseFactory(
      this.config.openAiApiKey,
      buildFinalVerifierRequest(session, this.config, mode)
    ) as FinalVerifierResponseEnvelope;
    if (!response.output_text) {
      const refusal = response.output.flatMap((item) => item.type === "message" ? (item.content ?? []) : [])
        .find((content) => content.type === "refusal");
      throw new Error(refusal?.refusal || "The model did not return a final verification result.");
    }
    return {
      output: semanticVerificationOutputSchema.parse(JSON.parse(response.output_text) as unknown),
      responseId: response.id,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null
    };
  }
}

interface FinalVerifierResponseEnvelope {
  id: string;
  output_text: string;
  output: Array<{
    type: string;
    content?: Array<{ type: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  } | null;
}
