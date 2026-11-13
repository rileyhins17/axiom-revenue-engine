import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(__dirname, "..", "..");
const plugin = join(root, "claude", "axiom-plugin");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; });

test("the Axiom plugin names both connectors and takes its keys from the environment, never from a file", () => {
  const servers = json(join(plugin, ".mcp.json")).mcpServers as Record<string, { type: string; url: string; headers: Record<string, string> }>;
  assert.deepEqual(Object.keys(servers).sort(), ["axiom-command", "axiom-engine"]);
  assert.equal(servers["axiom-command"]!.headers.Authorization, "Bearer ${AXIOM_COMMAND_KEY}");
  assert.equal(servers["axiom-engine"]!.headers.Authorization, "Bearer ${AXIOM_ENGINE_KEY}");
  for (const server of Object.values(servers)) {
    assert.equal(server.type, "http");
    assert.match(server.url, /^\$\{AXIOM_(COMMAND|ENGINE)_URL:-https:\/\/[a-z.]+\}\/api\/mcp$/);
  }
  // No file in the plugin carries anything shaped like a connector key (axc_, axl_, axe_, axel_ followed by the key itself).
  for (const path of [...files(plugin), join(root, ".claude-plugin", "marketplace.json")]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /\bax(c|l|e|el)_[A-Za-z0-9_-]{12,}/, `${path} holds something shaped like a key`);
  }
});

test("the marketplace entry points at the plugin and their names match, so the install lines in the README work", () => {
  const market = json(join(root, ".claude-plugin", "marketplace.json")) as { name: string; plugins: Array<{ name: string; source: string }> };
  const manifest = json(join(plugin, ".claude-plugin", "plugin.json")) as { name: string };
  assert.deepEqual(market.plugins.map((entry) => [entry.name, entry.source]), [[manifest.name, "./claude/axiom-plugin"]]);
  assert.match(manifest.name, /^[a-z][a-z0-9-]*$/);
  const readme = readFileSync(join(plugin, "README.md"), "utf8");
  assert.ok(readme.includes(`claude plugin install ${manifest.name}@${market.name}`));
  const skill = readFileSync(join(plugin, "skills", "axiom-engine", "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: axiom-engine\ndescription: .+\n---\n/);
  // The skill must keep saying what the connector can't do.
  for (const rule of ["Approve a batch", "resume a campaign", "Never send a real email as a test"]) assert.ok(skill.includes(rule), rule);
});
