import assert from "node:assert/strict";
import test from "node:test";

import manifest from "@/app/manifest";
import { APP_NAV_ITEMS, getNavItemForPath } from "@/lib/navigation";

test("owner navigation puts FCC first and keeps the old website campaign behind the archive link", () => {
  assert.deepEqual(APP_NAV_ITEMS.map((item) => item.title), ["Today", "FCC", "Ask AI", "Settings", "Archive: Axiom Web"]);
  assert.equal(getNavItemForPath("/fcc")?.title, "FCC");
  for (const archived of ["/call", "/prospects", "/walk-ins", "/email"]) {
    assert.equal(getNavItemForPath(archived)?.title, "Archive: Axiom Web", `${archived} opens from the archive`);
  }
  assert.equal(APP_NAV_ITEMS.some((item) => ["/leads", "/automation", "/clients", "/vault", "/call", "/walk-ins", "/email"].includes(item.url)), false);
});

test("installed app shortcuts open Today and FCC", () => {
  assert.deepEqual(manifest().shortcuts?.map((shortcut) => shortcut.url), ["/dashboard", "/fcc"]);
  assert.equal(manifest().short_name, "Axiom", "the home-screen label must fit under an iPhone icon");
});
