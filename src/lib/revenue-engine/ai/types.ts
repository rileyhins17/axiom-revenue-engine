import type { z } from "zod";

export const OPENAI_MODEL_POLICY = {
  extraction: "gpt-5.4-nano-2026-03-17",
  classification: "gpt-5.4-nano-2026-03-17",
  ranking: "gpt-5.4-nano-2026-03-17",
  deduplication: "gpt-5.4-nano-2026-03-17",
  reply_classification: "gpt-5.4-nano-2026-03-17",
  visual_audit: "gpt-5.4-mini-2026-03-17",
  outreach_draft: "gpt-5.4-mini-2026-03-17",
} as const;

export type AIWorkload = keyof typeof OPENAI_MODEL_POLICY;

export type StructuredAIRequest<T> = {
  workload: AIWorkload;
  schemaName: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  imageUrls?: string[];
  maxOutputTokens?: number;
  timeoutMs?: number;
  promptVersion: string;
};

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type StructuredAIResult<T> = {
  data: T;
  provider: "openai";
  model: string;
  responseId: string;
  promptVersion: string;
  attempts: number;
  durationMs: number;
  usage: AIUsage;
};

export interface AIProvider {
  generateStructured<T>(request: StructuredAIRequest<T>): Promise<StructuredAIResult<T>>;
}

export function modelForWorkload(workload: AIWorkload) {
  return OPENAI_MODEL_POLICY[workload];
}
