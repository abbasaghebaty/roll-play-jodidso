import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? collect(full) : [full];
  }));
  return nested.flat();
}

test('all relative JavaScript imports resolve to existing files', async () => {
  const files = (await collect(path.join(root, 'src'))).filter(file => file.endsWith('.js'));
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const pattern = /(?:from\s*|import\s*)['"]([.]{1,2}\/[^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
      const target = path.resolve(path.dirname(file), match[1]);
      try {
        await access(target);
      } catch {
        missing.push(path.relative(root, file) + ' -> ' + match[1]);
      }
    }
  }
  assert.deepEqual(missing, []);
});
