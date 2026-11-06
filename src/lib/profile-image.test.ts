import test from "node:test";
import assert from "node:assert/strict";

import { MAX_PROFILE_IMAGE_BYTES, validateProfileImage } from "./profile-image";

test("accepts a small jpeg, png or webp picture", () => {
  for (const type of ["jpeg", "png", "webp"]) {
    assert.equal(validateProfileImage(`data:image/${type};base64,AAAA`), null);
  }
});

test("rejects other kinds of file and plain web addresses", () => {
  assert.ok(validateProfileImage("data:image/svg+xml;base64,AAAA"));
  assert.ok(validateProfileImage("data:text/html;base64,AAAA"));
  assert.ok(validateProfileImage("https://example.com/me.png"));
  assert.ok(validateProfileImage("data:image/png;base64,"));
  assert.ok(validateProfileImage("data:image/png;base64,not base64!"));
});

test("rejects a picture over the size limit", () => {
  const big = "A".repeat(Math.ceil((MAX_PROFILE_IMAGE_BYTES * 4) / 3) + 8);
  assert.match(validateProfileImage(`data:image/jpeg;base64,${big}`) ?? "", /under 200KB/);
});
