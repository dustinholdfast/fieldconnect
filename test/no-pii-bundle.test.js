import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Demo emails live in server/fixtures/demo.js and prototype-data.js.
// They are loaded only when SEED_DEMO=true (seedDemo() at boot). They must
// never appear in the browser tree under js/.

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const MAIL = /@mail\.com/i;
const GOOGLE_FONTS = /fonts\.googleapis\.com/i;
const US_PHONE = /(?:\+1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]+)\d{3}[\s.-]+\d{4}/;

function walk(dir, files = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function hits(files, re) {
  const found = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (re.test(src)) found.push(file.slice(rootDir.length + 1));
  }
  return found;
}

test('js/ contains no @mail.com, Google Fonts, or US-looking phones', () => {
  const files = walk(join(rootDir, 'js'));
  assert.deepEqual(hits(files, MAIL), []);
  assert.deepEqual(hits(files, GOOGLE_FONTS), []);
  assert.deepEqual(hits(files, US_PHONE), []);
});

test('css/ does not load fonts.googleapis.com', () => {
  const files = walk(join(rootDir, 'css'));
  assert.deepEqual(hits(files, GOOGLE_FONTS), []);
});
