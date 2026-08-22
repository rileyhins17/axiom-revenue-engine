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
