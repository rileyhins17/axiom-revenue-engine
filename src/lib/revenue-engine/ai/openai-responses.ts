import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import {
  modelForWorkload,
  type AIProvider,
  type AIUsage,
  type StructuredAIRequest,
  type StructuredAIResult,
} from "@/lib/revenue-engine/ai/types";

const OpenAIResponseSchema = z.object({
  id: z.string(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            refusal: z.string().optional(),
          }).passthrough(),
        )
        .optional(),
    }).passthrough(),
  ),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
}).passthrough();

const MODEL_PRICES_USD_PER_MILLION = {
  "gpt-5.4-nano-2026-03-17": { input: 0.2, output: 1.25 },
  "gpt-5.4-mini-2026-03-17": { input: 0.75, output: 4.5 },
} as const;

type FetchLike = typeof fetch;

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export function estimateOpenAICostUsd(model: string, inputTokens: number, outputTokens: number) {
  const prices = MODEL_PRICES_USD_PER_MILLION[model as keyof typeof MODEL_PRICES_USD_PER_MILLION];
  if (!prices) return 0;
  return (inputTokens * prices.input + outputTokens * prices.output) / 1_000_000;
}

function extractOutputText(response: z.infer<typeof OpenAIResponseSchema>) {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") {
        throw new AIProviderError(content.refusal || "OpenAI refused the request", "provider_refusal");
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new AIProviderError("OpenAI response contained no structured output text", "missing_output");
}

function schemaForOpenAI<T>(schema: z.ZodType<T>) {
  const converted = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

function safeSchemaName(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!safe) throw new AIProviderError("Structured output schema name is empty", "invalid_request");
  return safe;
}

function isRetryable(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export class OpenAIResponsesProvider implements AIProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      fetch?: FetchLike;
      maxAttempts?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  async generateStructured<T>(request: StructuredAIRequest<T>): Promise<StructuredAIResult<T>> {
    if (!this.options.apiKey.trim()) {
      throw new AIProviderError("OPENAI_API_KEY is not configured", "not_configured");
    }

    const model = modelForWorkload(request.workload);
    const fetcher = this.options.fetch || fetch;
    const sleep = this.options.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const maxAttempts = Math.max(1, Math.min(this.options.maxAttempts || 2, 3));
    const startedAt = Date.now();
    const userContent: Array<Record<string, unknown>> = [
      { type: "input_text", text: request.userPrompt },
      ...(request.imageUrls || []).map((imageUrl) => ({ type: "input_image", image_url: imageUrl })),
    ];
    const body = {
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: request.systemPrompt }] },
        { role: "user", content: userContent },
      ],
      max_output_tokens: Math.max(64, Math.min(request.maxOutputTokens || 1200, 4000)),
      text: {
        format: {
          type: "json_schema",
          name: safeSchemaName(request.schemaName),
          strict: true,
          schema: schemaForOpenAI(request.schema),
        },
      },
    };

    let lastError: AIProviderError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs || 20_000);
      try {
        const response = await fetcher(`${(this.options.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const responseText = await response.text();
          const error = new AIProviderError(
            `OpenAI Responses request failed (${response.status}): ${responseText.slice(0, 300)}`,
            "http_error",
            response.status,
          );
          if (!isRetryable(response.status) || attempt === maxAttempts) throw error;
          lastError = error;
          const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
          await sleep(retryAfterSeconds > 0 ? Math.min(retryAfterSeconds * 1000, 10_000) : 250 * 2 ** (attempt - 1));
          continue;
        }

        const parsedResponse = OpenAIResponseSchema.safeParse(await response.json());
        if (!parsedResponse.success) {
          throw new AIProviderError("OpenAI returned an invalid response envelope", "invalid_response");
        }

        let json: unknown;
        try {
          json = JSON.parse(extractOutputText(parsedResponse.data));
        } catch (error) {
          if (error instanceof AIProviderError) throw error;
          throw new AIProviderError("OpenAI structured output was not valid JSON", "invalid_json");
        }

        const validated = request.schema.safeParse(json);
        if (!validated.success) {
          throw new AIProviderError("OpenAI structured output failed the local schema", "schema_mismatch");
        }

        const inputTokens = parsedResponse.data.usage?.input_tokens || 0;
        const outputTokens = parsedResponse.data.usage?.output_tokens || 0;
        const usage: AIUsage = {
          inputTokens,
          outputTokens,
          totalTokens: parsedResponse.data.usage?.total_tokens || inputTokens + outputTokens,
          estimatedCostUsd: estimateOpenAICostUsd(model, inputTokens, outputTokens),
        };

        return {
          data: validated.data,
          provider: "openai",
          model,
          responseId: parsedResponse.data.id,
          promptVersion: request.promptVersion,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          usage,
        };
      } catch (error) {
        const normalized = error instanceof AIProviderError
          ? error
          : new AIProviderError(error instanceof Error ? error.message : String(error), "network_error");
        lastError = normalized;
        if (attempt === maxAttempts || (normalized.status && !isRetryable(normalized.status))) throw normalized;
        await sleep(250 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new AIProviderError("OpenAI request failed", "unknown_error");
  }
}

export function createOpenAIProviderFromEnv() {
  const env = getServerEnv();
  return new OpenAIResponsesProvider({
    apiKey: env.OPENAI_API_KEY || "",
    baseUrl: env.OPENAI_API_BASE_URL,
    maxAttempts: 2,
  });
}
