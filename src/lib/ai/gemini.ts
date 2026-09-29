/**
 * Minimal Gemini API adapter (REST, no SDK). One JSON-mode request, no tools, no
 * retries: a failed call is reported, never silently repeated at extra cost.
 */
export const AI_MODEL = "gemini-3.1-flash-lite";
/** US$ per token for AI_MODEL (paid tier, checked 2026-09-24). */
export const AI_PRICE = { inputPerToken: 0.25 / 1_000_000, outputPerToken: 1.5 / 1_000_000 } as const;

export type AiCompletion = { text: string; inputTokens: number; outputTokens: number };
export class AiError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "BUDGET" | "PROVIDER" | "INVALID_OUTPUT" | "RATE_LIMITED", message: string = code) { super(message); }
}

export async function generateJson(input: {
  apiKey: string; system: string; user: string; maxOutputTokens: number; fetchImpl?: typeof fetch; timeoutMs?: number;
}): Promise<AiCompletion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 20_000);
  try {
    const response = await (input.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: input.maxOutputTokens, temperature: 0.4 },
      }),
    });
    if (response.status === 429) throw new AiError("RATE_LIMITED", "The AI is busy. Try again in a minute.");
    if (!response.ok) throw new AiError("PROVIDER", `AI provider returned ${response.status}.`);
    const body = await response.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return {
      text,
      inputTokens: Math.max(0, body.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: Math.max(0, (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0)),
    };
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("PROVIDER", error instanceof Error && error.name === "AbortError" ? "The AI took too long." : "Could not reach the AI.");
  } finally {
    clearTimeout(timer);
  }
}

export const costMicroUsd = (inputTokens: number, outputTokens: number) =>
  Math.ceil((inputTokens * AI_PRICE.inputPerToken + outputTokens * AI_PRICE.outputPerToken) * 1_000_000);

export type GeminiPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type ToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

/** One chat turn with function calling. The caller runs any requested functions and calls again. */
export async function generateWithTools(input: {
  apiKey: string; system: string; contents: GeminiContent[]; tools: ToolDeclaration[]; maxOutputTokens: number; fetchImpl?: typeof fetch; timeoutMs?: number;
}): Promise<{ parts: GeminiPart[]; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 25_000);
  try {
    const response = await (input.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.contents,
        tools: [{ functionDeclarations: input.tools }],
        generationConfig: { maxOutputTokens: input.maxOutputTokens, temperature: 0.3 },
      }),
    });
    if (response.status === 429) throw new AiError("RATE_LIMITED", "The AI is busy. Try again in a minute.");
    if (!response.ok) throw new AiError("PROVIDER", `AI provider returned ${response.status}.`);
    const body = await response.json() as { candidates?: { content?: { parts?: GeminiPart[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    return {
      parts: body.candidates?.[0]?.content?.parts ?? [],
      inputTokens: Math.max(0, body.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: Math.max(0, (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0)),
    };
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("PROVIDER", error instanceof Error && error.name === "AbortError" ? "The AI took too long." : "Could not reach the AI.");
  } finally {
    clearTimeout(timer);
  }
}
