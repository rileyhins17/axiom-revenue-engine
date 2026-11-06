// Live migrations run only inside scripts/release-production.mjs, after its backup.
console.error("Remote database migrations are blocked. They run only inside scripts/release-production.mjs, after a fresh backup. No database command was attempted.");
process.exitCode = 1;
