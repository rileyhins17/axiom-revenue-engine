import openNextWorkerModule, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

import { setCloudflareBindings } from "./src/lib/cloudflare";
import { clearServerEnvCache } from "./src/lib/env";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

const consoleWorker = {
  async fetch(request, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    return openNextWorkerModule.fetch(request, env, ctx);
  },
  scheduled() {
    // Legacy self-dispatch is retired, even if an obsolete trigger survives.
    // New schedules belong to the separately gated Revenue Engine Worker.
    return;
  },
};

export default consoleWorker;
