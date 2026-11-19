import assert from "node:assert/strict";
import test from "node:test";

import manifest from "@/app/manifest";
import { ALL_NAV_ITEMS, APP_NAV_ITEMS, MORE_NAV_ITEMS, getNavItemForPath } from "@/lib/navigation";

test("the tabs are Today, Replies and Campaigns; everything else is under More; FCC is only the archive", () => {
  assert.deepEqual(APP_NAV_ITEMS.map((item) => item.title), ["Today", "Replies", "Campaigns"]);
  assert.deepEqual(MORE_NAV_ITEMS.map((item) => item.title), ["Inboxes", "Do-not-email list", "FCC archive", "Settings"]);
  assert.ok(!APP_NAV_ITEMS.some((item) => /fcc/i.test(`${item.title} ${item.url} ${item.description}`)), "FCC is not a tab");
  assert.equal(new Set(ALL_NAV_ITEMS.map((item) => item.url)).size, ALL_NAV_ITEMS.length, "every screen has its own address");
});

test("every screen lights up its own entry, and old links still land somewhere", () => {
  assert.equal(getNavItemForPath("/dashboard")?.title, "Today");
  assert.equal(getNavItemForPath("/replies")?.title, "Replies");
  assert.equal(getNavItemForPath("/campaigns/us-cities")?.title, "Campaigns");
  assert.equal(getNavItemForPath("/campaigns/us-cities/batches/b-1")?.title, "Campaigns");
  assert.equal(getNavItemForPath("/inboxes")?.title, "Inboxes");
  assert.equal(getNavItemForPath("/do-not-email")?.title, "Do-not-email list");
  assert.equal(getNavItemForPath("/fcc")?.title, "FCC archive", "the old FCC link opens the archive");
  assert.equal(getNavItemForPath("/settings")?.title, "Settings");
  for (const retired of ["/call", "/prospects", "/walk-ins", "/email", "/archive", "/ask"]) {
    assert.equal(getNavItemForPath(retired), null, `${retired} is gone`);
  }
});

test("installed app shortcuts open Today, Replies and Campaigns, never FCC", () => {
  assert.deepEqual(manifest().shortcuts?.map((shortcut) => shortcut.url), ["/dashboard", "/replies", "/campaigns"]);
  assert.equal(manifest().short_name, "Axiom", "the home-screen label must fit under an iPhone icon");
});
