import assert from "node:assert/strict";
import test from "node:test";

import manifest from "@/app/manifest";
import { APP_NAV_ITEMS, getNavItemForPath } from "@/lib/navigation";

test("owner navigation is Today, Call list and Settings only", () => {
  assert.deepEqual(APP_NAV_ITEMS.map((item) => item.title), ["Today", "Call list", "Settings"]);
  assert.equal(getNavItemForPath("/prospects")?.title, "Call list");
  assert.equal(APP_NAV_ITEMS.some((item) => ["/leads", "/automation", "/clients", "/vault"].includes(item.url)), false);
});

test("installed app shortcuts open Today and the call list", () => {
  assert.deepEqual(manifest().shortcuts?.map((shortcut) => shortcut.url), ["/dashboard", "/prospects"]);
});
