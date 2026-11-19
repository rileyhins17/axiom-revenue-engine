import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const picomatch = require('next/dist/compiled/picomatch');

test('installed Next trace exclusions normalize Windows glob and file paths', async () => {
  const code = await readFile(require.resolve('next/dist/build/collect-build-traces'), 'utf8');
  // Evaluate the two path expressions used by the installed Next matcher. This
  // catches a dropped patch after npm ci or a dependency upgrade.
  const start = code.indexOf('const resolvedGlobs = [');
  const end = code.indexOf('// overwrite trace file', start);
  const block = 'if (combinedExcludes.size) {\n' + code.slice(start, end);
  const select = new Function('_path', '_picomatch', 'combinedExcludes', 'dir', 'pageDir', 'combined', block);
  for (const implementation of [path.win32, path.posix]) {
    const root = implementation.resolve('/fixture/app');
    const pageDir = implementation.join(root, '.next/server/app/api/fixture');
    const files = new Set(['../../../../../data/kw-evaluation/private.json', '../../../../../output/report.json', '../../../../../node_modules/package/runtime.js']);
    select({ default: implementation }, { default: picomatch }, new Set(['./data/**/*', './output/**/*']), root, pageDir, files);
    assert.deepEqual([...files], ['../../../../../node_modules/package/runtime.js']);
  }
});
