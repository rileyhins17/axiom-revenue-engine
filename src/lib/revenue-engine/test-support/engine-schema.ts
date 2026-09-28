import { readFileSync } from "node:fs";

/** The Revenue Engine call-list schema, in release order (live is at the last one). */
export const ENGINE_MIGRATIONS = [
  "0075_engine_prospects_and_call_log.sql", "0076_engine_email_outreach.sql", "0077_ai_call_briefs.sql", "0078_caller_tokens.sql",
  "0079_connected_caller.sql", "0080_health_alerts.sql", "0081_cloud_discovery.sql", "0082_caller_contact_edits.sql", "0083_wider_market.sql", "0084_site_check.sql",
] as const;

type Exec = { exec(sql: string): unknown };

/** Applies the engine migrations in order, stopping after `through` (inclusive) when given. */
export function applyEngineSchema(raw: Exec, through: (typeof ENGINE_MIGRATIONS)[number] = ENGINE_MIGRATIONS.at(-1)!) {
  for (const name of ENGINE_MIGRATIONS) {
    raw.exec(readFileSync(new URL(`../../../../migrations/${name}`, import.meta.url), "utf8"));
    if (name === through) return;
  }
}
