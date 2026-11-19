// Calls the engine's Claude connector over HTTP the way a real MCP client does, and prints one short line per
// call: the tool, whether it worked, a couple of fields from its answer, and how long it took.
//
//   CONNECTOR_KEY=<your key> node scripts/connector-smoke.mjs http://localhost:3311
//
// The key comes from the CONNECTOR_KEY setting (or the second argument) and is never printed. A key that starts
// with "axel_" is a link key, so it is sent in the address instead of the header.
//
// Against a local copy (localhost) it calls every read tool, then check_list with a made-up 3-row list and
// pause_campaign on the demo's school-districts campaign. Against any other address it only reads, unless you
// add --writes. Nothing here can approve a batch, resume a campaign or send an email.
// How to run a local copy with made-up data: docs/runbooks/CLAUDE_CONNECTOR.md.
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const [baseArg, keyArg] = args.filter((arg) => !arg.startsWith("--"));
const base = (baseArg ?? process.env.CONNECTOR_BASE ?? "").replace(/\/+$/, "");
const key = process.env.CONNECTOR_KEY ?? keyArg ?? "";
if (!base || !key) {
  console.error("usage: CONNECTOR_KEY=<key> node scripts/connector-smoke.mjs <base address> [--writes]");
  process.exit(1);
}
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);
const writes = local || flags.has("--writes");
const link = key.startsWith("axel_");
const address = link ? `${base}/api/mcp/k/${key}` : `${base}/api/mcp`;
const PAUSE = "school-districts";
// Made-up people and places; .example addresses can't receive mail, so the check holds every row and says why.
const CSV = [
  "email,first_name,title,city,state,verified,error_count,worst_problem",
  "dana@marrowsound.example,Dana,City Clerk,Marrow Sound,OR,yes,41,images have no text description",
  "omar@yarrowby.example,Omar,IT Manager,Yarrowby,WA,yes,58,form fields have no labels",
  "ines@bramblewick.example,Ines,Web Administrator,Bramblewick,ID,no,12,text is too faint to read",
].join("\n");

let id = 0;
let failed = 0;
const short = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
};
// The list check looks up each email domain's mail server on the internet. Where that can't be reached, the
// connector says so in a plain sentence: worth showing, not a failure of the connector.
const NO_LOOKUP = /^Couldn't look up the mail servers/;

/** One JSON-RPC message. A notice carries no id and gets no answer (HTTP 202). */
async function rpc(method, params, notice = false) {
  const started = Date.now();
  const response = await fetch(address, {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(link ? {} : { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ jsonrpc: "2.0", ...(notice ? {} : { id: ++id }), method, ...(params ? { params } : {}) }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, ms: Date.now() - started };
}

/** `ok` is true, false, or "note" for an answer worth reading that isn't a failure. */
function line(name, ok, fields, ms) {
  if (ok === false) failed += 1;
  console.log(`${name.padEnd(20)} ${ok === true ? "ok  " : ok === "note" ? "note" : "FAIL"} ${String(ms).padStart(5)} ms  ${Object.entries(fields).map(([field, value]) => `${field}=${short(value)}`).join("  ")}`);
}

/** One tool call. `pick` chooses the couple of fields to print from the tool's answer. */
async function tool(name, toolArgs, pick, expectRefusal = false) {
  const { status, body, ms } = await rpc("tools/call", { name, arguments: toolArgs });
  const result = body?.result;
  if (!result) { line(name, false, { http: status, error: body?.error?.message ?? "no answer" }, ms); return null; }
  if (result.isError) {
    const said = result.content?.[0]?.text ?? "";
    line(name, expectRefusal ? true : NO_LOOKUP.test(said) ? "note" : false, { said }, ms);
    return null;
  }
  const data = result.structuredContent ?? JSON.parse(result.content[0].text);
  line(name, !expectRefusal, pick(data), ms);
  return data;
}

console.log(`${local ? "Local copy" : "Not a local copy"}: ${base} (${link ? "link key in the address" : "key in the header"}; ${writes ? "reads, a list check and one pause" : "reads only"})`);

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "connector-smoke", version: "1" } });
if (!init.body?.result) {
  line("initialize", false, { http: init.status, error: init.body?.error?.message ?? "no answer" }, init.ms);
  process.exit(1);
}
line("initialize", true, { server: init.body.result.serverInfo.name, protocol: init.body.result.protocolVersion, as: /connected as (\w+)/.exec(init.body.result.instructions)?.[1] ?? "?" }, init.ms);
const notice = await rpc("notifications/initialized", undefined, true);
line("initialized notice", notice.status === 202 && notice.body === null, { http: notice.status }, notice.ms);
const listed = await rpc("tools/list");
const names = (listed.body?.result?.tools ?? []).map((item) => item.name);
line("tools/list", names.length > 0, { tools: names.length, readOnly: (listed.body?.result?.tools ?? []).filter((item) => item.annotations?.readOnlyHint).length }, listed.ms);

await tool("engine_today", {}, (d) => ({ summary: d.summary, sentToday: d.sendingToday.emails, at: d.atToronto }));
const campaigns = await tool("list_campaigns", {}, (d) => ({ campaigns: d.campaigns.length, first: `${d.campaigns[0]?.key} ${d.campaigns[0]?.state}` }));
const campaign = campaigns?.campaigns.find((row) => row.key === "us-cities") ?? campaigns?.campaigns[0];
if (campaign) await tool("get_campaign", { campaign: campaign.key }, (d) => ({ name: d.name, batches: d.batches.length, emailed: d.numbers.emailed, success: `${d.numbers.success.count} ${d.numbers.success.label}` }));
const batches = await tool("list_batches", {}, (d) => ({ batches: d.count, waiting: d.batches.filter((batch) => batch.state === "waiting").length }));
const batch = batches?.batches.find((row) => row.state === "waiting") ?? batches?.batches[0];
if (batch) await tool("get_batch", { batch: batch.id }, (d) => ({ name: d.batch.name, samples: d.samples.length, held: d.heldRowsInAll, subject: d.samples[0]?.first?.subject ?? "" }));
const replies = await tool("list_replies", { filter: "all", limit: 10 }, (d) => ({ shown: d.replies.length, toAnswer: d.howManyByFilter["to-answer"], fcc: d.fccReplies }));
const reply = replies?.replies[0];
if (reply) await tool("get_reply", { id: reply.id }, (d) => ({ from: d.reply.organisation, at: d.reply.atToronto, answerFrom: d.reply.answerFromName ?? "nobody" }));
const found = await tool("find_contact", { query: reply?.organisation ?? "example", limit: 5 }, (d) => ({ found: d.found, first: d.contacts[0]?.statusText ?? "", blocked: d.contacts[0]?.blocked ?? "" }));
await tool("inbox_health", {}, (d) => ({ inboxes: d.inboxes.length, first: `${d.inboxes[0]?.owner}: ${d.inboxes[0]?.sentToday} of ${d.inboxes[0]?.limitToday}, ${d.inboxes[0]?.nextSend}` }));
await tool("check_do_not_email", { address: found?.contacts[0]?.email ?? "nobody@nowhere.example" }, (d) => ({ kind: d.kind, blocked: d.blocked, reasons: d.reasons.length }));
await tool("week_numbers", {}, (d) => ({ week: d.week, sent: d.totals.sent, replies: d.totals.replies, campaigns: d.campaigns.length }));

if (writes) {
  await tool("check_list", { campaign: PAUSE, name: "smoke check (not saved)", csv: CSV }, (d) => ({ saved: d.saved, rows: d.rows, ready: d.ready, held: d.held, why: d.heldRows[0]?.reason ?? "" }));
  await tool("pause_campaign", { campaign: PAUSE, reason: "Connector smoke test on a local copy" }, (d) => ({ state: d.state, changed: d.changed, by: d.by }));
  // What the connector must refuse: an extra argument that tries to start the campaign again, and a tool that doesn't exist.
  await tool("pause_campaign", { campaign: PAUSE, reason: "try to resume", state: "live" }, () => ({}), true);
  const none = await rpc("tools/call", { name: "approve_batch", arguments: { batch: batch?.id ?? "b-none" } });
  line("approve_batch", none.body?.error?.code === -32602, { said: none.body?.error?.message ?? "it answered" }, none.ms);
}

console.log(failed ? `${failed} call${failed === 1 ? "" : "s"} failed.` : "Every call answered as expected.");
process.exit(failed ? 1 : 0);
