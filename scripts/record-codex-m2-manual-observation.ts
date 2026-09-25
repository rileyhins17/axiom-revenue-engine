import { pathToFileURL } from "node:url";

import { readLocalM2OwnerIdentityPacket } from "../src/lib/revenue-engine/m2-owner-identity-packet";
import { readLatestPrivateKwM2OwnerDecisions } from "../src/lib/revenue-engine/m2-owner-identity-local-store";
import { getApprovedM2ManualWebsiteObservationTargets } from "../src/lib/revenue-engine/m2-manual-website-observation-targets";
import { M2ManualWebsiteObservationCommandSchema } from "../src/lib/revenue-engine/m2-manual-website-observation";
import { assertM2CodexManualObservationAuthorization } from "../src/lib/revenue-engine/m2-codex-manual-observation-authorization";
import { saveM2ManualWebsiteObservation } from "../src/lib/revenue-engine/m2-manual-website-observation-local-store";
import { readPrivateKwJson, resolvePrivateKwDataPath } from "./private-kw-files";

const MAX_INPUT_BYTES = 8_192;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--") || values.has(name)) throw new Error("Usage: npm run kw:record-codex-m2-observation -- --authorization data/kw-evaluation/authorization.json --command data/kw-evaluation/command.json");
    values.set(name, value);
  }
  if (values.size !== 2 || !values.has("--authorization") || !values.has("--command")) throw new Error("Exactly --authorization and --command are required.");
  const authorization = resolvePrivateKwDataPath(values.get("--authorization")!);
  const command = resolvePrivateKwDataPath(values.get("--command")!);
  if (authorization === command) throw new Error("Authorization and command must use separate files.");
  return { authorization, command };
}

export async function recordCodexM2ManualObservation(args: string[], now = new Date()) {
  const files = parseArgs(args);
  const [authorizationRead, commandRead] = await Promise.all([
    readPrivateKwJson(files.authorization, MAX_INPUT_BYTES),
    readPrivateKwJson(files.command, MAX_INPUT_BYTES),
  ]);
  const command = M2ManualWebsiteObservationCommandSchema.parse(commandRead.value);
  const packet = await readLocalM2OwnerIdentityPacket();
  if (packet.status !== "READY") throw new Error("The exact current M2 identity packet is unavailable.");
  const decisions = await readLatestPrivateKwM2OwnerDecisions(packet.packetSha256);
  if (!decisions) throw new Error("Current saved M2 KEEP/REPLACE identity decisions are unavailable.");
  const target = getApprovedM2ManualWebsiteObservationTargets(packet, decisions)
    .find((candidate) => candidate.reviewId === command.reviewId);
  if (!target) throw new Error("This business is not selected by the current M2 KEEP/REPLACE decisions.");
  const authorization = assertM2CodexManualObservationAuthorization(authorizationRead.value, target, command, now);
  const saved = await saveM2ManualWebsiteObservation(command, target, "CODEX", {
    clock: () => now,
    authorizationProof: {
      sourceAuthorizationDigest: authorization.authorizationDigest,
      retentionReviewDate: authorization.authorization.retentionReviewDate,
    },
  });
  return { ...saved, recordedBy: "CODEX" as const, reviewId: target.reviewId, businessName: target.businessName, retentionReviewDate: authorization.authorization.retentionReviewDate };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recordCodexM2ManualObservation(process.argv.slice(2))
    .then((result) => {
      console.log(`${result.status}: ${result.reviewId} ${result.businessName} (${result.observationId})`);
      console.log(`Saved locally as CODEX; retention review date: ${result.retentionReviewDate}. No automatic deletion is performed.`);
      console.log("This does not count as an M2 assessment or authorize qualification, contact, outreach, providers, deployment, or spend.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Codex M2 manual observation was not saved.");
      process.exitCode = 1;
    });
}
