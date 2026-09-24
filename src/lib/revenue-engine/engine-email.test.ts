import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { composeFirstEmail, EMAIL_TEMPLATE_VERSION, PermanentEmailError, runDailyEmail, unsubscribe, type EmailRunConfig, type OutgoingEmail } from "./engine-email";
import type { ProspectDb } from "./engine-prospects-d1";
import { openSmtp, type SmtpStream } from "./smtp-client";

function database() {
  const raw = new Database(":memory:");
  raw.exec(readFileSync("migrations/0075_engine_prospects_and_call_log.sql", "utf8"));
  raw.exec(readFileSync("migrations/0076_engine_email_outreach.sql", "utf8"));
  const insert = raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const email = raw.prepare(`INSERT INTO "EngineProspectEmail" VALUES (?,?,?,'MAILTO_LINK','2026-09-24','run1')`);
  for (let i = 1; i <= 14; i += 1) {
    insert.run(`s${i}.example`, `p${i}`, `Roofer ${i}`, "KITCHENER", "ROOFING", `https://s${i}.example/`, null, null, "STRONG", '["No tap-to-call button","Page is hard to read on a phone"]', "run1", `2026-09-${String(i).padStart(2, "0")}`, "2026-09-24");
    email.run(`s${i}.example`, `info@s${i}.example`, `https://s${i}.example/contact`);
  }
  insert.run("ok.example", "p99", "Fine HVAC", "WATERLOO", "HVAC", "https://ok.example/", null, null, "WEAK", "[]", "run1", "2026-09-01", "2026-09-24");
  email.run("ok.example", "info@ok.example", "https://ok.example/");
  const db: ProspectDb = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return { bind: (...values: unknown[]) => ({
        all: async <T,>() => ({ results: statement.all(...values) as T[] }),
        first: async <T,>() => (statement.get(...values) as T | undefined) ?? null,
        run: async () => statement.run(...values),
      }) };
    },
  };
  return { raw, db };
}

let n = 0;
const id = () => `id-${++n}`;
const token = () => `tok${String(++n).padStart(40, "0")}`;
const WEEKDAY = new Date("2026-09-24T14:00:00Z");

function fakeTransport(fail?: (message: OutgoingEmail) => Error | null) {
  const sent: OutgoingEmail[] = [];
  return { sent, factory: async () => ({ async send(message: OutgoingEmail) { const error = fail?.(message); if (error) throw error; sent.push(message); }, async close() {} }) };
}
const config = (transport: EmailRunConfig["transport"], overrides: Partial<EmailRunConfig> = {}): EmailRunConfig => ({
  workerSwitch: true, fromName: "Riley Hinsperger", fromAddress: "riley@getaxiom.ca", baseUrl: "https://operations.getaxiom.ca/", transport, newId: id, newToken: token, ...overrides,
});
const approve = (raw: Database.Database) => raw.prepare(`UPDATE "EngineEmailSetting" SET "enabled"=1, "templateApprovedVersion"=?`).run(EMAIL_TEMPLATE_VERSION);

test("nothing is sent unless every switch, approval and weekday gate passes", async () => {
  const { raw, db } = database();
  const t = fakeTransport();
  assert.deepEqual(await runDailyEmail(db, config(t.factory), WEEKDAY), { status: "SKIPPED", reason: "owner switch off" });
  raw.prepare(`UPDATE "EngineEmailSetting" SET "enabled"=1`).run();
  assert.deepEqual(await runDailyEmail(db, config(t.factory), WEEKDAY), { status: "SKIPPED", reason: "template not approved" });
  approve(raw);
  assert.deepEqual(await runDailyEmail(db, config(t.factory, { workerSwitch: false }), WEEKDAY), { status: "SKIPPED", reason: "worker switch off" });
  assert.deepEqual(await runDailyEmail(db, config(null), WEEKDAY), { status: "SKIPPED", reason: "sender not configured" });
  assert.deepEqual(await runDailyEmail(db, config(t.factory), new Date("2026-09-26T14:00:00Z")), { status: "SKIPPED", reason: "weekend" });
  assert.equal(t.sent.length, 0);
  assert.throws(() => raw.prepare(`UPDATE "EngineEmailSetting" SET "dailyCap"=11`).run(), /CHECK/);
});

test("sends at most 10 a day, only to weak-website businesses, once ever, and logs each send", async () => {
  const { raw, db } = database();
  approve(raw);
  const t = fakeTransport();
  const first = await runDailyEmail(db, config(t.factory), WEEKDAY);
  assert.deepEqual(first, { status: "RAN", sent: 10, failed: 0, remainingToday: 0 });
  assert.equal(t.sent.some((m) => m.to === "info@ok.example"), false, "site-OK businesses are never emailed");
  assert.deepEqual(await runDailyEmail(db, config(t.factory), WEEKDAY), { status: "SKIPPED", reason: "daily cap reached" });
  const next = await runDailyEmail(db, config(t.factory), new Date("2026-09-25T14:00:00Z"));
  assert.equal(next.status === "RAN" && next.sent, 4);
  assert.equal(new Set(t.sent.map((m) => m.to)).size, 14, "no address twice");
  assert.equal((raw.prepare(`SELECT COUNT(*) n FROM "EngineProspectActivity" WHERE "channel"='EMAIL'`).get() as Record<string, unknown>).n, 14);
  const message = t.sent[0]!;
  assert.match(message.text, /257 Kipling Ave, Kitchener, ON N2C 2B9/);
  assert.match(message.text, /https:\/\/operations\.getaxiom\.ca\/unsubscribe\?t=tok/);
  assert.match(message.headers["List-Unsubscribe"]!, /^<https:\/\/operations\.getaxiom\.ca\/api\/unsubscribe\?t=/);
  assert.throws(() => raw.prepare(`DELETE FROM "EngineEmailSend"`).run(), /NO_DELETE/);
});

test("unsubscribe and do-not-contact are permanent; bounces suppress; provider errors stop the day", async () => {
  const { raw, db } = database();
  approve(raw);
  raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId") VALUES ('a','k','s1.example','CALL','DO_NOT_CONTACT','','AIDAN','u')`).run();
  const t = fakeTransport((m) => m.to === "info@s2.example" ? new PermanentEmailError("550 no such user") : m.to === "info@s5.example" ? new Error("421 try later") : null);
  const result = await runDailyEmail(db, config(t.factory), WEEKDAY);
  assert.deepEqual(result, { status: "RAN", sent: 2, failed: 2, remainingToday: 6 });
  assert.deepEqual(t.sent.map((m) => m.to), ["info@s3.example", "info@s4.example"]);
  assert.equal((raw.prepare(`SELECT "reason" FROM "EngineEmailSuppression" WHERE "email"='info@s2.example'`).get() as Record<string, unknown>).reason, "BOUNCED");

  const tok = (raw.prepare(`SELECT "unsubscribeToken" t FROM "EngineEmailSend" WHERE "email"='info@s3.example'`).get() as Record<string, unknown>).t as string;
  assert.equal(await unsubscribe(db, tok), "DONE");
  assert.equal(await unsubscribe(db, tok), "DONE");
  assert.equal(await unsubscribe(db, "x".repeat(40)), "UNKNOWN");
  assert.equal((raw.prepare(`SELECT COUNT(*) n FROM "EngineEmailSuppression" WHERE "email"='info@s3.example'`).get() as Record<string, unknown>).n, 1);
  assert.throws(() => raw.prepare(`DELETE FROM "EngineEmailSuppression"`).run(), /PERMANENT/);
});

test("the email only states observed problems and identifies the sender", () => {
  const { subject, text } = composeFirstEmail({ prospectId: "x", name: "Acme Roofing", city: "KITCHENER", niche: "ROOFING", websiteUrl: "https://www.acme.example/", reasons: ["No tap-to-call button", "Old copyright year", "third"], email: "hi@acme.example", sourceUrl: "https://www.acme.example/contact" }, "https://u/", "Riley Hinsperger");
  assert.equal(subject, "Quick question about the Acme Roofing website");
  assert.match(text, /acme\.example/);
  assert.doesNotMatch(text, /third/);
  assert.doesNotMatch(text, /guarantee|increase|clients like|case study/i);
});

test("the SMTP client authenticates, sends a base64 message and maps 550 to a permanent failure", async () => {
  const written: string[] = [];
  const replies = ["220 ready", "250-zoho\r\n250 AUTH LOGIN", "334 u", "334 p", "235 ok", "250 ok", "250 ok", "354 go", "250 queued", "250 ok", "550 no mailbox", "221 bye"];
  let push: (chunk: Uint8Array) => void = () => undefined;
  const readable = new ReadableStream<Uint8Array>({ start(controller) { push = (c) => controller.enqueue(c); } });
  const next = () => { const line = replies.shift(); if (line) push(new TextEncoder().encode(`${line}\r\n`)); };
  const writable = new WritableStream<Uint8Array>({ write(chunk) { written.push(new TextDecoder().decode(chunk)); next(); } });
  const stream: SmtpStream = { readable, writable, close: async () => undefined };
  next();
  const smtp = await openSmtp(stream, { host: "smtp.zoho.com", username: "riley@getaxiom.ca", password: "secret", fromName: "Riley Hinsperger", fromAddress: "riley@getaxiom.ca" }, () => "m1");
  await smtp.send({ to: "a@b.example", subject: "Hi", text: "Body é", headers: { "List-Unsubscribe": "<https://u/>" } });
  await assert.rejects(() => smtp.send({ to: "c@d.example", subject: "Hi", text: "x", headers: {} }), PermanentEmailError);
  await smtp.close();
  const all = written.join("");
  assert.match(all, /AUTH LOGIN\r\n/);
  assert.match(all, /MAIL FROM:<riley@getaxiom\.ca>/);
  assert.match(all, /Content-Transfer-Encoding: base64/);
  assert.match(all, /List-Unsubscribe: <https:\/\/u\/>/);
  assert.match(all, /\r\n\.\r\n/);
  assert.doesNotMatch(all, /secret/, "password is never sent in clear text");
});
