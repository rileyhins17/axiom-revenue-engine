import { getCloudflareBindings } from "@/lib/cloudflare";

/**
 * A plain-text setting of the live Worker (FCC_SENDER_ADDRESS, FCC_CAMPAIGN_MAILING_ADDRESS, APP_BASE_URL...).
 * On Cloudflare it comes from the Worker's own settings and nowhere else. On a local copy, which has none,
 * it falls back to the process environment so the screens can be previewed with made-up values.
 */
export function engineSetting(name: string): string {
  const bindings = getCloudflareBindings();
  const value = bindings ? bindings[name] : process.env[name];
  return typeof value === "string" ? value.trim() : "";
}
