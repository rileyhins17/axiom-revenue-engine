import assert from "node:assert/strict";
import test from "node:test";

import manifest from "@/app/manifest";
import { APP_NAV_ITEMS, getNavItemForPath } from "@/lib/navigation";

test("primary owner navigation opens the evidence-first Leads route", () => {
  const leads = APP_NAV_ITEMS.find((item) => item.title === "Leads");

  assert.equal(leads?.url, "/leads");
  assert.equal(getNavItemForPath("/leads")?.title, "Leads");
  assert.equal(APP_NAV_ITEMS.some((item) => item.url === "/vault"), false);
});

test("installed app shortcut opens the evidence-first Leads route", () => {
  const leadsShortcut = manifest().shortcuts?.find((shortcut) => shortcut.name === "Leads");

  assert.equal(leadsShortcut?.url, "/leads");
});
