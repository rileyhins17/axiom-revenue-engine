console.error("Production migration is blocked: the current default config targets the legacy production D1.");
console.error("Use a separately reviewed isolated target only after a current export and restore rehearsal.");
process.exitCode = 1;
