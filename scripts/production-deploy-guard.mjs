// A plain deploy would skip the backup, the live-settings check and the automatic rollback.
console.error("Plain deploys are blocked. Release only through scripts/release-production.mjs (backup, checks, smoke test, automatic rollback). No Cloudflare upload was attempted.");
process.exitCode = 1;
