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

const APPROVED_INSTRUCTION_DIGESTS = Object.freeze({
  "docs-researcher.toml": "6590669d013daa18fcc03da203a84435f9f6738d71cd969576ea6e31178649b7",
  "implementation-worker.toml": "94e66b89754941a311faa90f3095c32062358ec900aa792e1508922e1ab1cd18",
  "lead-quality-auditor.toml": "8a299338dd02a51e8051409983252d6b2e355e641b7f7129814e96a9aad3156d",
  "repo-explorer.toml": "64f2953dfdb094e4c1e2798ae917c5f823532704ee77b328f324cc51475d7d1c",
  "security-reviewer.toml": "6bcbab8cc4c58fe0351110e636fc8ef796c1dbb43e22c757230789bc7a84c215",
  "test-auditor.toml": "d1d6d303f2b536fe64083a7244acefd382cf9b169739b8e01b3dcd594ccefa4c",
  "ui-qa.toml": "58aee370bea70c4cf012ea2ad0102586b7cc87d02bc03659ee7850fcdd33b29c",
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
