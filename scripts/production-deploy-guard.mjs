console.error("Production deploy is blocked: the current default config targets the legacy production D1.");
console.error("Provision and verify an isolated production target and backed-up release path before enabling deployment.");
process.exitCode = 1;
