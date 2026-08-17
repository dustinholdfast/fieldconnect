import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(rootDir, 'assets');
const manifestPath = join(rootDir, 'asset-manifest.json');

const IMPORT_RE = /((?:from|import)\s+)(['"])(\.\.?\/[^'"]+)\2/g;

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function posixRel(abs) {
  return relative(rootDir, abs).split('\\').join('/');
}

function sha12(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

function hashedUrl(sourceUrl, hash) {
  const slash = sourceUrl.lastIndexOf('/');
  const dir = sourceUrl.slice(0, slash + 1);
  const base = sourceUrl.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? '' : base.slice(dot);
  return `/assets${dir}${stem}-${hash}${ext}`;
}

function resolveSpecifier(fromUrl, spec) {
  return new URL(spec, `http://asset.local${fromUrl}`).pathname;
}

function collectSources() {
  const files = [];
  for (const dir of ['css', 'js', 'shared']) {
    for (const abs of walk(join(rootDir, dir))) {
      if (!/\.(js|css)$/.test(abs)) continue;
      const url = `/${posixRel(abs)}`;
      files.push({ abs, url, source: readFileSync(abs) });
    }
  }
  return files;
}

function rewriteJs(source, fromUrl, hashed) {
  return source.replace(IMPORT_RE, (match, prefix, quote, spec) => {
    const resolved = resolveSpecifier(fromUrl, spec);
    const dest = hashed.get(resolved);
    if (!dest) return match;
    return `${prefix}${quote}${dest}${quote}`;
  });
}

export function buildAssets() {
  const outDir = assetsDir;
  const manifestFile = manifestPath;
  const sources = collectSources();
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  const hashed = new Map();
  const rewritten = new Map();
  const pending = new Set(sources.map((s) => s.url));

  while (pending.size) {
    let progress = false;
    for (const url of [...pending]) {
      const file = byUrl.get(url);
      const text = file.source.toString('utf8');
      const deps = [];
      if (url.endsWith('.js')) {
        for (const m of text.matchAll(IMPORT_RE)) {
          const resolved = resolveSpecifier(url, m[3]);
          if (byUrl.has(resolved)) deps.push(resolved);
        }
      }
      if (!deps.every((d) => hashed.has(d))) continue;
      const outText = url.endsWith('.js') ? rewriteJs(text, url, hashed) : text;
      const hash = sha12(outText);
      hashed.set(url, hashedUrl(url, hash));
      rewritten.set(url, outText);
      pending.delete(url);
      progress = true;
    }
    if (!progress) {
      throw new Error(`unresolved asset imports: ${[...pending].join(', ')}`);
    }
  }

  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const manifest = {};
  for (const [url, dest] of hashed) {
    manifest[url] = dest;
    const destAbs = join(rootDir, dest.slice(1));
    mkdirSync(dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, rewritten.get(url));
  }
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const manifest = buildAssets();
  const count = Object.keys(manifest).length;
  process.stdout.write(`hashed ${count} assets → ${relative(rootDir, manifestPath)}\n`);
}
