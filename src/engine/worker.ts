import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import {
  BusinessWorkflowInputSchema,
  createInitialWorkflowReceipt,
  haltWorkflowReceipt,
  type BusinessWorkflowInput,
  type WorkflowReceipt,
} from "./contracts";
import { engineHealth, parseLockedEngineEnvironment } from "./safety";

const NO_RETRIES = {
  retries: {
    limit: 0,
    delay: 0,
    backoff: "constant" as const,
  },
};

export class RevenueBusinessWorkflow extends WorkflowEntrypoint<RevenueEngineEnv, BusinessWorkflowInput> {
  async run(event: Readonly<WorkflowEvent<BusinessWorkflowInput>>, step: WorkflowStep): Promise<WorkflowReceipt> {
    const receipt = await step.do("validate immutable workflow input", NO_RETRIES, async () => {
      parseLockedEngineEnvironment(this.env);
      const input = BusinessWorkflowInputSchema.parse(event.payload);
      return createInitialWorkflowReceipt(input);
    });

    return step.do("halt inert scaffold", NO_RETRIES, async () =>
      haltWorkflowReceipt(receipt, {
        code: "scaffold_locked",
        message: "The engine scaffold has no consumer, schedule, data binding, provider credential, or execution authority.",
        haltedAt: event.timestamp.toISOString(),
      }),
    );
  }
}

export default {
  async fetch(request: Request, env: RevenueEngineEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(engineHealth(env), {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<RevenueEngineEnv>;
