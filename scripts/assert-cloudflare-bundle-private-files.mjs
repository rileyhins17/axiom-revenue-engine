import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const privateDirectories = new Set([
  "backups", "data", "kw-evaluation", ".superpowers", ".claude", ".wrangler", ".vercel", ".git",
]);

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

function isPrivateBundlePath(root, file) {
  const segments = path.relative(root, file).split(path.sep).map((part) => part.toLowerCase());
  if (segments.some((part) => privateDirectories.has(part))) return true;
  if (segments[0] === "output") return true;
  if (segments.includes("server-functions") && !segments.includes("node_modules") && segments.includes("output")) return true;
  return /\.(?:sqlite|db|pem)$/i.test(file);
}

export async function assertCloudflareBundleHasNoPrivateFiles(directory = ".open-next") {
  const root = path.resolve(directory);
  const files = await listFiles(root);
  const privateFiles = files.filter((file) => isPrivateBundlePath(root, file));
  if (privateFiles.length) {
    throw new Error(`Cloudflare bundle contains ${privateFiles.length} private workspace files`);
  }
  return { filesScanned: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await assertCloudflareBundleHasNoPrivateFiles(process.argv[2]);
  console.log(`Cloudflare bundle private-file check passed (${result.filesScanned} files scanned).`);
}
