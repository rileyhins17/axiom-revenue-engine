import { executePrivateKwM2HtmlAssessment } from "./execute-private-kw-m2-html-assessment";
import { createRun } from "./private-kw-m2-html-assessment.acceptance";

const OUTCOMES = [
  "COMPLETE",
  "RESEARCH_REQUIRED",
  "ROBOTS_BLOCKED",
  "RETENTION_BLOCKED",
  "COMPLETE",
  "RESEARCH_REQUIRED",
  "COMPLETE",
  "COMPLETE",
  "COMPLETE",
  "PARTIAL",
] as const;

/**
 * Creates the ten-business local owner-console fixture. Task4 evidence is
 * persisted through the canonical native stores; the HTTP transport remains
 * the committed deterministic fixture transport and never opens the network.
 * The final PARTIAL business is included after the preceding nine ordered
 * outcomes so the native sealed receipt can be inspected in the same run.
 */
export async function createM2OwnerConsoleFixture() {
  const run = await createRun(OUTCOMES.map((outcome) => ({ outcome })), true);
  try {
    const selected = run.operations.map((operation, index) => ({
      index,
      businessId: operation.businessId,
      businessName: run.captures[0]!.chain.sourcePlan.records[index]!.business.canonicalName,
    }));

    for (let index = 0; index < OUTCOMES.length; index++) {
      const outcome = OUTCOMES[index];
      const operation = run.operations[index]!;
      if (outcome === "COMPLETE") {
        await run.approve(index);
        await executePrivateKwM2HtmlAssessment(run.runPath, operation.businessId, "EXECUTE", run.dependencies);
      } else {
        await executePrivateKwM2HtmlAssessment(run.runPath, operation.businessId, "PREPARE", run.dependencies);
      }
    }

    return {
      runPath: run.runPath,
      databasePath: run.databasePath,
      receiptPath: run.receiptPath,
      backupPath: run.backupPath,
      selected,
      operations: run.operations,
      captures: run.captures,
      requests: run.requests,
      dependencies: run.dependencies,
      cleanup: run.cleanup,
    };
  } catch (error) {
    await run.cleanup();
    throw error;
  }
}
