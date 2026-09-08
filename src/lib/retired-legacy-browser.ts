export const LEGACY_BROWSER_RETIRED_REASON = "Legacy browser scraping is retired. Use the separately approved Revenue Engine evidence workflow.";

export function rejectLegacyBrowserWork(): never {
  throw new Error(LEGACY_BROWSER_RETIRED_REASON);
}
