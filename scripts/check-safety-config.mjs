// Fast, offline check that the live config can't start anything nobody approved.
// Runs in CI; scripts/release-production.mjs repeats the same checks before any deploy.
import { readFile } from "node:fs/promises";

const config = JSON.parse((await readFile(new URL("../wrangler.production.jsonc", import.meta.url), "utf8")).replace(/^\s*\/\/.*$/gm, ""));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const problems = [];
const expect = (ok, problem) => { if (!ok) problems.push(problem); };

expect(config.name === "axiom-ops-omniscient", "the live config must target the axiom-ops-omniscient Worker");
expect(config.keep_vars === true, "keep_vars must stay true, so a deploy can't drop settings that live only on the Worker");
expect((config.triggers?.crons ?? []).join("|") === "*/15 * * * *|* 14-19 * * *", "only the health check and the FCC send tick may be scheduled");
for (const key of ["AUTONOMOUS_SEND_ENABLED", "AUTONOMOUS_QUEUE_ENABLED", "AUTONOMOUS_INTAKE_ENABLED", "ENGINE_EMAIL_ENABLED"]) {
  expect(!(key in (config.vars ?? {})) || config.vars[key] === "false", `${key} must not be turned on`);
}
expect(config.vars?.AUTH_PASSWORD_SIGNIN === "false", "live sign-in is by emailed code only");
const login = (config.send_email ?? []).find((binding) => binding.name === "LOGIN_EMAIL");
expect(JSON.stringify(login?.allowed_destination_addresses ?? []) === JSON.stringify(["rileyhinsperger@gmail.com", "aidanmageebusiness@gmail.com"]), "sign-in codes and alerts may only go to the two founders' inboxes");
expect(packageJson.scripts?.deploy === "node scripts/production-deploy-guard.mjs", "npm run deploy must stay blocked");
expect(packageJson.scripts?.["db:migrate:remote"] === "node scripts/production-migration-guard.mjs", "npm run db:migrate:remote must stay blocked");

if (problems.length) {
  console.error(`Safety config check FAILED:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Safety config check passed.");
