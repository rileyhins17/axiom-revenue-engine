import assert from "node:assert/strict";
import test from "node:test";

import manifest from "@/app/manifest";
import { APP_NAV_ITEMS, getNavItemForPath } from "@/lib/navigation";

test("primary owner navigation opens the business research route", () => {
  const leads = APP_NAV_ITEMS.find((item) => item.title === "Businesses");

  assert.equal(leads?.url, "/leads");
  assert.equal(getNavItemForPath("/leads")?.title, "Businesses");
  assert.equal(APP_NAV_ITEMS.some((item) => item.url === "/vault"), false);
});

test("installed app shortcut opens the business research route", () => {
  const leadsShortcut = manifest().shortcuts?.find((shortcut) => shortcut.name === "Businesses");

  assert.equal(leadsShortcut?.url, "/leads");
});
