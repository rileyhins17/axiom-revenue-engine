import { lstat, mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRIVATE_DATA_ROOT = path.resolve(REPOSITORY_ROOT, "data", "kw-evaluation");

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolvePrivateKwDataPath(value: string) {
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!isInside(PRIVATE_DATA_ROOT, resolved)) {
    throw new Error("Private KW files must stay inside data/kw-evaluation/.");
  }
  if (path.dirname(resolved) !== PRIVATE_DATA_ROOT) {
    throw new Error("Private KW files must be direct children of data/kw-evaluation/.");
  }
  if (path.extname(resolved).toLocaleLowerCase("en-CA") !== ".json") {
    throw new Error("Private KW files must use the .json extension.");
  }
  return resolved;
}

export function resolvePrivateKwDatabasePath(value: string) {
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!isInside(PRIVATE_DATA_ROOT, resolved)) {
    throw new Error("Private KW databases must stay inside data/kw-evaluation/.");
  }
  if (path.dirname(resolved) !== PRIVATE_DATA_ROOT) {
    throw new Error("Private KW databases must be direct children of data/kw-evaluation/.");
  }
  if (path.extname(resolved).toLocaleLowerCase("en-CA") !== ".sqlite") {
    throw new Error("Private KW databases must use the .sqlite extension.");
  }
  return resolved;
}

async function assertSafePrivateRoot() {
  await mkdir(PRIVATE_DATA_ROOT, { recursive: true });
  if ((await lstat(PRIVATE_DATA_ROOT)).isSymbolicLink()) {
    throw new Error("The private KW data directory cannot be a symbolic link.");
  }
}

export async function readPrivateKwJson(value: string, maxBytes: number) {
  const file = resolvePrivateKwDataPath(value);
  await assertSafePrivateRoot();
  if ((await lstat(file)).isSymbolicLink()) {
    throw new Error("Private KW input files cannot be symbolic links.");
  }
  const inputStats = await stat(file);
  if (!inputStats.isFile() || inputStats.size > maxBytes) {
    throw new Error(`The private KW input must be a JSON file no larger than ${maxBytes} bytes.`);
  }
  return { file, value: JSON.parse(await readFile(file, "utf8")) as unknown };
}

export async function writePrivateKwJson(value: string, data: unknown) {
  const file = resolvePrivateKwDataPath(value);
  await assertSafePrivateRoot();
  const handle = await open(file, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return file;
}

export const PRIVATE_KW_JSON_OUTPUT_MAX_BYTES = 50_000_000;

/**
 * Create one ignored local JSON checkpoint, or prove that an existing file is
 * the exact byte-for-byte replay of the same checkpoint. Existing files are
 * opened for reading and never replaced, truncated, or repaired.
 */
export async function writeOrVerifyPrivateKwJson(
  value: string,
  data: unknown,
  maxBytes = PRIVATE_KW_JSON_OUTPUT_MAX_BYTES,
) {
  const file = resolvePrivateKwDataPath(value);
  await assertSafePrivateRoot();
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const expected = Buffer.from(serialized, "utf8");
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || expected.byteLength > maxBytes) {
    throw new Error(`The private KW output must be a JSON file no larger than ${maxBytes} bytes.`);
  }

  try {
    const handle = await open(file, "wx");
    try {
      await handle.writeFile(expected);
    } finally {
      await handle.close();
    }
    return { file, executionPath: "FRESH_WRITE" as const };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const linkStats = await lstat(file);
  if (linkStats.isSymbolicLink()) {
    throw new Error("Private KW output files cannot be symbolic links.");
  }
  const handle = await open(file, "r");
  try {
    const fileStats = await handle.stat();
    if (!fileStats.isFile() || fileStats.size > maxBytes) {
      throw new Error(`The private KW output must be a JSON file no larger than ${maxBytes} bytes.`);
    }
    const current = await handle.readFile();
    if (!current.equals(expected)) {
      try {
        JSON.parse(current.toString("utf8"));
      } catch {
        throw new Error("The existing private KW output is malformed JSON and cannot be replayed.");
      }
      throw new Error("The existing private KW output conflicts with the exact replay bytes.");
    }
    return { file, executionPath: "EXACT_REPLAY" as const };
  } finally {
    await handle.close();
  }
}

export async function inspectPrivateKwDatabase(value: string, maxBytes: number) {
  const file = resolvePrivateKwDatabasePath(value);
  await assertSafePrivateRoot();
  if ((await lstat(file)).isSymbolicLink()) {
    throw new Error("Private KW database files cannot be symbolic links.");
  }
  const inputStats = await stat(file);
  if (!inputStats.isFile() || inputStats.size > maxBytes) {
    throw new Error(`The private KW database must be a SQLite file no larger than ${maxBytes} bytes.`);
  }
  return file;
}
