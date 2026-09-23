import { pathToFileURL } from "node:url";

import { readLocalM2OwnerIdentityPacket } from "../src/lib/revenue-engine/m2-owner-identity-packet";
import { readM2DelegatedTargets } from "../src/lib/revenue-engine/m2-delegated-targets";
import { M2WebsiteNeedCommandSchema } from "../src/lib/revenue-engine/m2-website-need-assessment";
import { saveM2WebsiteNeedAssessment } from "../src/lib/revenue-engine/m2-website-need-local-store";
import { readPrivateKwJson } from "./private-kw-files";

const MAX_INPUT_BYTES = 32_768;

export async function currentM2Targets() {
  const packet = await readLocalM2OwnerIdentityPacket();
  if (packet.status !== "READY") throw new Error("The exact current M2 identity packet is unavailable.");
  return readM2DelegatedTargets(packet);
}

/** Records one delegated website-need assessment for a currently selected M2 business. */
export async function recordM2WebsiteNeed(args: string[]) {
  if (args.length === 1 && args[0] === "--targets") return { targets: await currentM2Targets() };
  if (args.length !== 1) throw new Error("Usage: npm run kw:record-m2-website-need -- data/kw-evaluation/<assessment-command>.json | --targets");
  const command = M2WebsiteNeedCommandSchema.parse((await readPrivateKwJson(args[0]!, MAX_INPUT_BYTES)).value);
  const target = (await currentM2Targets()).find((candidate) => candidate.reviewId === command.reviewId);
  if (!target) throw new Error("This business is not selected by the current M2 KEEP/REPLACE decisions.");
  const saved = await saveM2WebsiteNeedAssessment(command, target);
  return { status: saved.status, reviewId: target.reviewId, businessName: target.businessName, websiteNeed: saved.assessment.websiteNeed, assessmentId: saved.assessment.assessmentId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recordM2WebsiteNeed(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!("targets" in result)) console.log("Saved locally as CLAUDE (delegated by Riley). Qualification, contact, outreach, providers, deployment and spend remain off.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "The website-need assessment was not saved.");
      process.exitCode = 1;
    });
}
