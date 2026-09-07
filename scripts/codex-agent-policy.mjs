import { createHash } from "node:crypto";

export const APPROVED_CODEX_AGENT_FILES = Object.freeze([
  "docs-researcher.toml",
  "implementation-worker.toml",
  "lead-quality-auditor.toml",
  "repo-explorer.toml",
  "security-reviewer.toml",
  "test-auditor.toml",
  "ui-qa.toml",
]);

const PROJECT_KEYS = Object.freeze([
  "model",
  "model_reasoning_effort",
  "agents.enabled",
  "agents.default_subagent_model",
  "agents.default_subagent_reasoning_effort",
  "agents.max_concurrent_threads_per_session",
]);

const ROLE_KEYS = Object.freeze([
  "name",
  "description",
  "model",
  "model_reasoning_effort",
  "model_verbosity",
  "sandbox_mode",
  "developer_instructions",
]);

const CANONICAL_CHILD_PROHIBITION = "Never spawn another agent; never override the configured model, reasoning effort, verbosity, sandbox, or permissions; never commit, push, merge, rebase, deploy, migrate, contact a prospect, use live providers/resources, access OneDrive or Google Drive, or expose secrets.";
const CANONICAL_CHECKOUT_ATTESTATION = "Before reading any project file, prove that the resolved Git top level equals C:/Users/riley/Documents/ChatGPT/APE and that the branch and HEAD equal the task packet. Stop on any mismatch. Every filesystem or Git command must target that exact checkout with an absolute path or git -C; never trust the inherited working directory. Return the attested root, branch, and HEAD in Checks.";

const APPROVED_INSTRUCTION_DIGESTS = Object.freeze({
  "docs-researcher.toml": "81da7801f0a24f929e7753538d5347a410423b160b919659115da53b949e3617",
  "implementation-worker.toml": "fe49549c179a35cb228f07003968183648b217f9cc35635cef67fcbbb64a5175",
  "lead-quality-auditor.toml": "6622d078dc0b06ed0e8e4260266a3ae07b0299c860021b82a6959737faf8dbe3",
  "repo-explorer.toml": "28c12ab01f6e5e35eac413eac2ab18e04d2c79fc52ae38801471dd919882528b",
  "security-reviewer.toml": "1e7f5f3032308a694a14627b7526399407791c6ec0106cd28439b1934bba4d64",
  "test-auditor.toml": "a86cefc1319ddbaf19013e383e74197720d7df7e5a928ff54357e6ed9e5559a9",
  "ui-qa.toml": "7c1266013e47b5be2b16578e8c9662fc32bea44d5ff0d716a9c1dc9200e42433",
});

function parseStrictCodexToml(name, content, failures) {
  const values = new Map();
  const declaredTables = new Set();
  const lines = content.split(/\r?\n/);
  let table = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const tableMatch = line.match(/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/);
    if (tableMatch) {
      table = tableMatch[1];
      if (declaredTables.has(table)) failures.push(`${name}:${index + 1}: duplicate TOML table ${table}`);
      declaredTables.add(table);
      continue;
    }
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!assignment) {
      failures.push(`${name}:${index + 1}: unsupported TOML syntax`);
      continue;
    }
    const key = table ? `${table}.${assignment[1]}` : assignment[1];
    if (values.has(key)) {
      failures.push(`${name}:${index + 1}: duplicate TOML key ${key}`);
      continue;
    }
    const raw = assignment[2];
    let value;
    if (raw === '"""') {
      const block = [];
      let closed = false;
      while (index + 1 < lines.length) {
        index += 1;
        if (lines[index].trim() === '"""') {
          closed = true;
          break;
        }
        block.push(lines[index]);
      }
      if (!closed) failures.push(`${name}: unterminated multiline string for ${key}`);
      value = block.join("\n");
    } else if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
      try {
        value = JSON.parse(raw);
      } catch {
        failures.push(`${name}:${index + 1}: invalid string for ${key}`);
      }
    } else if (raw === "true" || raw === "false") {
      value = raw === "true";
    } else if (/^-?\d+$/.test(raw)) {
      value = Number(raw);
    } else {
      failures.push(`${name}:${index + 1}: unsupported TOML value for ${key}`);
    }
    values.set(key, value);
  }
  values.declaredTables = declaredTables;
  return values;
}

function requireExactKeys(name, values, expectedKeys, failures) {
  const actual = [...values.keys()].sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${name}: exact keys must be ${expected.join(", ")}`);
  }
}

function requireValue(name, values, key, expected, failures) {
  if (values.get(key) !== expected) failures.push(`${name}: ${key} must equal ${JSON.stringify(expected)}`);
}

export function validateCodexAgentPolicy({ projectConfig, agentConfigs }) {
  const failures = [];
  const projectValues = parseStrictCodexToml(".codex/config.toml", projectConfig, failures);
  if (JSON.stringify([...projectValues.declaredTables]) !== JSON.stringify(["agents"])) {
    failures.push(".codex/config.toml: exactly one agents table is required");
  }
  requireExactKeys(".codex/config.toml", projectValues, PROJECT_KEYS, failures);
  requireValue(".codex/config.toml", projectValues, "model", "gpt-5.6-sol", failures);
  requireValue(".codex/config.toml", projectValues, "model_reasoning_effort", "high", failures);
  requireValue(".codex/config.toml", projectValues, "agents.enabled", true, failures);
  requireValue(".codex/config.toml", projectValues, "agents.default_subagent_model", "gpt-5.6-luna", failures);
  requireValue(".codex/config.toml", projectValues, "agents.default_subagent_reasoning_effort", "max", failures);
  requireValue(".codex/config.toml", projectValues, "agents.max_concurrent_threads_per_session", 3, failures);

  const discoveredFiles = [...agentConfigs.keys()].sort();
  if (JSON.stringify(discoveredFiles) !== JSON.stringify(APPROVED_CODEX_AGENT_FILES)) {
    failures.push(`.codex/agents: exact approved role files must be ${APPROVED_CODEX_AGENT_FILES.join(", ")}`);
  }

  for (const [fileName, content] of [...agentConfigs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const path = `.codex/agents/${fileName}`;
    const values = parseStrictCodexToml(path, content, failures);
    if (values.declaredTables.size !== 0) failures.push(`${path}: role files must not declare TOML tables`);
    requireExactKeys(path, values, ROLE_KEYS, failures);
    requireValue(path, values, "name", fileName.replace(/\.toml$/, "").replaceAll("-", "_"), failures);
    requireValue(path, values, "model", "gpt-5.6-luna", failures);
    requireValue(path, values, "model_reasoning_effort", "max", failures);
    requireValue(path, values, "model_verbosity", "low", failures);
    requireValue(path, values, "sandbox_mode", fileName === "implementation-worker.toml" ? "workspace-write" : "read-only", failures);

    const instructions = String(values.get("developer_instructions") ?? "").replace(/\s+/g, " ").trim();
    const instructionDigest = createHash("sha256").update(instructions).digest("hex");
    if (instructionDigest !== APPROVED_INSTRUCTION_DIGESTS[fileName]) failures.push(`${path}: approved instruction digest is required`);
    if (!instructions.includes(CANONICAL_CHECKOUT_ATTESTATION)) failures.push(`${path}: canonical checkout attestation is required before project reads`);
    if (!instructions.includes(CANONICAL_CHILD_PROHIBITION)) failures.push(`${path}: canonical child prohibitions are required without exceptions`);
    if (/\b(?:except|unless|when necessary|if needed|may override)\b/i.test(instructions)) failures.push(`${path}: child prohibitions may not contain exception wording`);
    const instructionsOutsideCanonicalPolicy = instructions.replace(CANONICAL_CHILD_PROHIBITION, "");
    if (/\b(?:overrid\w*|permit(?:ted|s)?|permissions?|escalat\w*|danger-full-access)\b|\b(?:broader|expanded|live|network) access\b/i.test(instructionsOutsideCanonicalPolicy)) {
      failures.push(`${path}: authority-escalation wording is forbidden outside the canonical policy`);
    }
    if (fileName !== "implementation-worker.toml" && !instructions.includes("Never edit files.")) failures.push(`${path}: read-only roles must explicitly forbid file edits`);
    if (fileName === "implementation-worker.toml") {
      if (!instructions.includes("exclusive file allowlist")) failures.push(`${path}: exclusive file allowlist is required`);
      if (!instructions.includes("starting commit, allowed files, and final changed-file list")) failures.push(`${path}: starting commit, allowed files, and final changed-file list are required`);
      if (!instructions.includes("Never edit AGENTS.md, .codex/, docs/STATUS.md, docs/OWNER_CONTEXT.md")) failures.push(`${path}: shared agent and status files must remain Sol-owned`);
    }
  }
  return failures;
}
