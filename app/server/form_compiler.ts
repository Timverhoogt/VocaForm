import { enforceCompilerSafety } from "../domain/compiler";
import { formCompilerOutputSchema, type FormCompilerOutput } from "../domain/schemas";
import type { AppConfig } from "./config";
import type { PreparedCompilerDocument } from "./document_upload";
import { buildCompilerRequest } from "./form_compiler_request";
import { createOpenAiResponse } from "./openai_client.mjs";

export interface CompilerCallResult {
  output: FormCompilerOutput;
  responseId: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class OpenAiFormCompiler {
  constructor(private readonly config: AppConfig) {
    if (!config.openAiApiKey) throw new Error("OPENAI_API_KEY is required to compile uploaded forms.");
  }

  async compile(document: PreparedCompilerDocument): Promise<CompilerCallResult> {
    const rawResponse = await createOpenAiResponse(
      this.config.openAiApiKey,
      buildCompilerRequest(document, this.config)
    ) as unknown;
    const response = rawResponse as CompilerResponseEnvelope;
    if (!response.output_text) {
      const refusal = response.output.flatMap((item) => item.type === "message" ? (item.content ?? []) : [])
        .find((content) => content.type === "refusal");
      throw new Error(refusal?.refusal || "The model did not return a form compilation.");
    }
    const parsed = formCompilerOutputSchema.parse(JSON.parse(response.output_text) as unknown);
    return {
      output: enforceCompilerSafety(parsed),
      responseId: response.id,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null
    };
  }

}

interface CompilerResponseEnvelope {
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
