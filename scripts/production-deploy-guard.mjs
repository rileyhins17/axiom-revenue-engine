console.error("Production deployment is blocked: this checkout still targets the legacy production Worker and D1 database. No Cloudflare upload was attempted.");
process.exitCode = 1;