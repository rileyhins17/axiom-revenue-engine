console.error("Production deploy is intentionally guarded.");
console.error("Use the protected GitHub production workflow after backup, CI, staging, approval, and rollback verification.");
process.exitCode = 1;
