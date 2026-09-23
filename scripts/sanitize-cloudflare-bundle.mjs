import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modes = ["production", "development", "test"];
const emptyCompiledEnvironment = `${modes.map((mode) => `export const ${mode} = {};`).join("\n")}\n`;
const sensitiveKeyPattern = /(?:^|_)(?:API_?KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIALS?)(?:_|$)/i;
const secretShapePatterns = [
  { label: "OpenAI-style API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

export function parseCompiledEnvironment(source) {
  const parsed = {};

  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^export const (production|development|test) = (.+);$/.exec(line);
    if (!match) throw new Error("OpenNext compiled environment has an unexpected format");
    parsed[match[1]] = JSON.parse(match[2]);
  }

  for (const mode of modes) {
    if (!parsed[mode] || typeof parsed[mode] !== "object" || Array.isArray(parsed[mode])) {
      throw new Error(`OpenNext compiled environment is missing ${mode}`);
    }
  }

  return parsed;
}

async function listFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
    else if (entry.isSymbolicLink()) throw new Error("Cloudflare bundle contains a symbolic link");
  }

  return files;
}

function isPrivateWorkspaceFile(outputRoot, filePath) {
  const segments = path.relative(outputRoot, filePath).split(path.sep).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => ["backups", "kw-evaluation", ".superpowers", ".claude", ".wrangler", ".vercel", ".git"].includes(segment))) {
    return true;
  }
  if (segments.includes("server-functions") && segments.some((segment) => ["data", "output"].includes(segment))) {
    return true;
  }
  return /\.(?:sqlite|db|pem)$/i.test(filePath);
}

export async function sanitizeCloudflareBundle(outputDirectory = ".open-next") {
  const absoluteOutput = path.resolve(outputDirectory);
  const bundleFiles = await listFiles(absoluteOutput);
  const privateCount = bundleFiles.filter((filePath) => isPrivateWorkspaceFile(absoluteOutput, filePath)).length;
  if (privateCount > 0) {
    throw new Error(`Cloudflare bundle contains ${privateCount} private workspace files`);
  }
  const compiledEnvPath = path.join(absoluteOutput, "cloudflare", "next-env.mjs");
  const compiledSource = await readFile(compiledEnvPath, "utf8");
  const compiled = parseCompiledEnvironment(compiledSource);
  const sensitiveValues = new Map();

  for (const mode of modes) {
    for (const [key, value] of Object.entries(compiled[mode])) {
      if (sensitiveKeyPattern.test(key) && typeof value === "string" && value.length > 0) {
        sensitiveValues.set(`${key}\u0000${value}`, { key, value });
      }
    }
  }

  // OpenNext intentionally packages values from Next .env files for runtime
  // fallback. Axiom uses Cloudflare bindings instead, so a deployable bundle
  // must never retain local file values, secret or otherwise.
  await writeFile(compiledEnvPath, emptyCompiledEnvironment, { encoding: "utf8", mode: 0o600 });

  const leaks = [];
  for (const filePath of bundleFiles) {
    const content = await readFile(filePath);
    const relativePath = path.relative(process.cwd(), filePath);

    for (const { key, value } of sensitiveValues.values()) {
      if (content.includes(Buffer.from(value))) leaks.push(`${relativePath}: value from ${key}`);
    }

    const text = content.toString("utf8");
    for (const { label, pattern } of secretShapePatterns) {
      if (pattern.test(text)) leaks.push(`${relativePath}: ${label}`);
    }
  }

  if (leaks.length > 0) {
    throw new Error(`Cloudflare bundle secret scan failed:\n${[...new Set(leaks)].map((leak) => `- ${leak}`).join("\n")}`);
  }

  return { filesScanned: bundleFiles.length, sensitiveValuesRemoved: sensitiveValues.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await sanitizeCloudflareBundle(process.argv[2]);
  console.log(
    `Cloudflare bundle sanitized: removed ${result.sensitiveValuesRemoved} local secret value(s) and scanned ${result.filesScanned} files.`,
  );
}
