import { z } from "zod";

export const REVENUE_WORKFLOW_RECEIPT_VERSION = "revenue-workflow-receipt-v1";
export const REVENUE_BUSINESS_WORKFLOW_INPUT_VERSION = "revenue-business-workflow-input-v1";

export const RevenueWorkflowStepSchema = z.enum([
  "discover",
  "normalize",
  "deduplicate",
  "audit",
  "collect_evidence",
  "find_contacts",
  "verify_channels",
  "score",
  "route",
  "draft",
  "await_approval",
  "send",
  "observe_response",
]);

export const RevenueWorkflowStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "HALTED",
  "COMPLETED",
  "FAILED",
]);

export const RevenueStepStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "SKIPPED",
  "FAILED",
]);

export const BusinessWorkflowInputSchema = z
  .object({
    inputVersion: z.literal(REVENUE_BUSINESS_WORKFLOW_INPUT_VERSION),
    workflowId: z.string().uuid(),
    businessId: z.string().trim().min(1).max(128),
    idempotencyKey: z.string().trim().min(8).max(200),
    requestedAt: z.string().datetime({ offset: true }),
    mode: z.literal("SHADOW"),
    policyVersion: z.string().trim().min(1).max(80),
    auditVersion: z.string().trim().min(1).max(80),
    maxCostUsd: z.literal(0),
  })
  .strict();

export const WorkflowStepReceiptSchema = z
  .object({
    step: RevenueWorkflowStepSchema,
    status: RevenueStepStatusSchema,
    attempts: z.number().int().nonnegative(),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    costUsd: z.number().nonnegative(),
    outputRef: z.string().trim().min(1).nullable(),
    failureReason: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const WorkflowReceiptSchema = z
  .object({
    receiptVersion: z.literal(REVENUE_WORKFLOW_RECEIPT_VERSION),
    workflowId: z.string().uuid(),
    businessId: z.string().trim().min(1).max(128),
    idempotencyKey: z.string().trim().min(8).max(200),
    status: RevenueWorkflowStatusSchema,
    currentStep: RevenueWorkflowStepSchema.nullable(),
    policyVersion: z.string().trim().min(1).max(80),
    auditVersion: z.string().trim().min(1).max(80),
    mode: z.literal("SHADOW"),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    cost: z
      .object({
        limitUsd: z.literal(0),
        spentUsd: z.literal(0),
      })
      .strict(),
    steps: z.array(WorkflowStepReceiptSchema).length(RevenueWorkflowStepSchema.options.length),
    resultRef: z.string().trim().min(1).nullable(),
    failure: z
      .object({
        code: z.string().trim().min(1).max(80),
        message: z.string().trim().min(1).max(500),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type BusinessWorkflowInput = z.infer<typeof BusinessWorkflowInputSchema>;
export type RevenueWorkflowStep = z.infer<typeof RevenueWorkflowStepSchema>;
export type WorkflowReceipt = z.infer<typeof WorkflowReceiptSchema>;

export function createInitialWorkflowReceipt(input: BusinessWorkflowInput): WorkflowReceipt {
  const validated = BusinessWorkflowInputSchema.parse(input);
  const steps = RevenueWorkflowStepSchema.options.map((step) => ({
    step,
    status: "PENDING" as const,
    attempts: 0,
    startedAt: null,
    completedAt: null,
    costUsd: 0,
    outputRef: null,
    failureReason: null,
  }));

  return WorkflowReceiptSchema.parse({
    receiptVersion: REVENUE_WORKFLOW_RECEIPT_VERSION,
    workflowId: validated.workflowId,
    businessId: validated.businessId,
    idempotencyKey: validated.idempotencyKey,
    status: "READY",
    currentStep: "discover",
    policyVersion: validated.policyVersion,
    auditVersion: validated.auditVersion,
    mode: validated.mode,
    createdAt: validated.requestedAt,
    updatedAt: validated.requestedAt,
    cost: {
      limitUsd: 0,
      spentUsd: 0,
    },
    steps,
    resultRef: null,
    failure: null,
  });
}

export function haltWorkflowReceipt(
  receipt: WorkflowReceipt,
  input: { code: string; message: string; haltedAt: string },
): WorkflowReceipt {
  return WorkflowReceiptSchema.parse({
    ...receipt,
    status: "HALTED",
    currentStep: null,
    updatedAt: input.haltedAt,
    failure: {
      code: input.code,
      message: input.message,
    },
  });
}
