import { pathToFileURL } from "node:url";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const BACKUP_REFERENCE_PATTERN = /^d1:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?:sha256:[0-9a-f]{64}$/;

export function validateReleaseInputs(releaseSha, backupReference) {
  const errors = [];
  const normalizedSha = String(releaseSha || "").trim();
  const normalizedBackup = String(backupReference || "").trim();

  if (!RELEASE_SHA_PATTERN.test(normalizedSha)) {
    errors.push("release_sha must be an exact 40-character Git commit SHA");
  }

  if (!BACKUP_REFERENCE_PATTERN.test(normalizedBackup)) {
    errors.push("backup_reference must match d1:<database-name>:sha256:<64 lowercase hex characters>");
  }

  return { valid: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validateReleaseInputs(process.argv[2], process.argv[3]);
  if (!result.valid) {
    for (const error of result.errors) console.error(`Release input rejected: ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Release inputs validated.");
  }
}
