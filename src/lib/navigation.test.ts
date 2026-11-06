import assert from "node:assert/strict";
import test from "node:test";

import manifest from "@/app/manifest";
import { APP_NAV_ITEMS, getNavItemForPath } from "@/lib/navigation";

test("owner navigation is Today, Campaigns, FCC and Settings, with nothing from the old call campaign", () => {
  assert.deepEqual(APP_NAV_ITEMS.map((item) => item.title), ["Today", "Campaigns", "FCC", "Settings"]);
  assert.equal(getNavItemForPath("/campaigns/us-cities")?.title, "Campaigns");
  assert.equal(getNavItemForPath("/fcc")?.title, "FCC");
  assert.equal(getNavItemForPath("/dashboard")?.title, "Today");
  for (const retired of ["/call", "/prospects", "/walk-ins", "/email", "/archive", "/ask"]) {
    assert.equal(getNavItemForPath(retired), null, `${retired} is gone`);
  }
});

test("installed app shortcuts open Today and FCC", () => {
  assert.deepEqual(manifest().shortcuts?.map((shortcut) => shortcut.url), ["/dashboard", "/fcc"]);
  assert.equal(manifest().short_name, "Axiom", "the home-screen label must fit under an iPhone icon");
});
