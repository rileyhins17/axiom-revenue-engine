console.error("Remote database migration is blocked: this checkout still targets the legacy production D1 database. No database command was attempted.");
process.exitCode = 1;