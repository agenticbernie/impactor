#!/usr/bin/env node
/** Build-time only: package the real portable runtime, never a second interpreter. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = ['src/components/runtime/', 'src/components/blocks/', 'src/components/providers/', 'src/lib/schema/', 'src/lib/engine/', 'src/lib/web3/', 'src/types/'];
const sources = {};
const dependencies = new Set(['next', 'react', 'react-dom']);
const pending = ['src/components/runtime/RuntimeApp.tsx', 'src/components/runtime/runtime.css', 'src/lib/schema/index.ts', 'src/types/styles.d.ts'];
const extensions = ['', '.ts', '.tsx', '.json', '.css', '/index.ts', '/index.tsx'];
const isTest = (name) => /(?:^|\/)(?:__tests__|tests)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);

async function exists(file) {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}
function packageName(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}
async function include(specifier, importer) {
  if (specifier.startsWith('@/') || specifier.startsWith('.')) {
    const base = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
    for (const extension of extensions) {
      const candidate = base + extension;
      if (await exists(path.join(root, candidate))) {
        if (!allowed.some((prefix) => candidate.startsWith(prefix)) || isTest(candidate)) {
          throw new Error(`Portable runtime crosses its source boundary: ${importer} -> ${candidate}`);
        }
        pending.push(candidate);
        return;
      }
    }
    throw new Error(`Runtime source is missing: ${importer} -> ${specifier}. Run bundling after all runtime sources are available.`);
  }
  if (specifier.startsWith('node:') || /^(?:https?:|data:|\/)/.test(specifier)) throw new Error(`Nonportable runtime import: ${specifier}`);
  dependencies.add(packageName(specifier));
}

while (pending.length) {
  const file = pending.pop();
  if (Object.hasOwn(sources, file)) continue;
  const absolute = path.join(root, file);
  if (!await exists(absolute)) throw new Error(`Runtime source is missing: ${file}. Complete runtime implementation before dev/build.`);
  // Refuse symlinks that escape the repository's portable source area.
  const realRelative = path.relative(root, await fs.realpath(absolute)).split(path.sep).join('/');
  if (!allowed.some((prefix) => realRelative.startsWith(prefix))) throw new Error(`Nonportable symlink: ${file}`);
  const content = await fs.readFile(absolute, 'utf8');
  sources[file] = content;
  const imports = new Set();
  if (/\.tsx?$/.test(file)) {
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) imports.add(node.argument.literal.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error(`Dynamic runtime import cannot be bundled safely: ${file}`);
        imports.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  } else if (file.endsWith('.css')) {
    for (const match of content.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) imports.add(match[1]);
    for (const match of content.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
      if (!match[1].startsWith('data:')) imports.add(match[1]);
    }
  }
  for (const specifier of imports) await include(specifier, file);
}

const rootPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const lockSource = await fs.readFile(path.join(root, 'package-lock.json'), 'utf8');
const lock = JSON.parse(lockSource);
const rootLockHash = createHash('sha256').update(lockSource).digest('hex');
if (lock.lockfileVersion < 2 || !lock.packages) throw new Error('A current npm package-lock.json is required to create a reproducible export.');
const devNames = ['typescript', 'eslint', 'eslint-config-next', '@eslint/eslintrc', '@types/node', '@types/react', '@types/react-dom'];
async function exactVersions(names) {
  const versions = {};
  for (const name of [...names].sort()) {
    if (!rootPackage.dependencies?.[name] && !rootPackage.devDependencies?.[name]) throw new Error(`Portable dependency ${name} must be declared in the root package.json.`);
    const installed = JSON.parse(await fs.readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (lock.packages[`node_modules/${name}`]?.version !== installed.version) throw new Error(`Installed ${name} does not match package-lock.json; run npm ci before bundling.`);
    versions[name] = installed.version;
  }
  return versions;
}
const manifest = {
  name: 'exported-dapp', version: '0.1.0', private: true,
  scripts: { dev: 'next dev', build: 'next build', start: 'next start', typecheck: 'tsc --noEmit', lint: 'eslint .' },
  dependencies: await exactVersions(dependencies),
  devDependencies: await exactVersions(devNames),
};

// Retain the actual resolved dependency graph, including installed optional peers,
// without pulling editor/deployment-only dependencies into exported applications.
const selected = new Set();
function resolvePackage(name, parent = '') {
  let cursor = parent;
  while (true) {
    const location = `${cursor ? `${cursor}/` : ''}node_modules/${name}`;
    if (lock.packages[location]) return location;
    if (!cursor) return null;
    const last = cursor.lastIndexOf('/node_modules/');
    cursor = last < 0 ? '' : cursor.slice(0, last);
  }
}
function walkPackage(name, parent = '', optional = false) {
  const location = resolvePackage(name, parent);
  if (!location) {
    if (optional) return;
    throw new Error(`Lockfile is incomplete: ${name} required by ${parent || 'export'}`);
  }
  if (selected.has(location)) return;
  selected.add(location);
  const entry = lock.packages[location];
  for (const dependency of Object.keys(entry.dependencies || {})) walkPackage(dependency, location, Boolean(entry.optionalDependencies?.[dependency]));
  for (const dependency of Object.keys(entry.optionalDependencies || {})) walkPackage(dependency, location, true);
  for (const dependency of Object.keys(entry.peerDependencies || {})) walkPackage(dependency, location, Boolean(entry.peerDependenciesMeta?.[dependency]?.optional));
}
for (const name of [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]) walkPackage(name);
// Carry security resolutions that actually apply to the portable dependency graph,
// excluding compiler/editor-only overrides. Scope-qualified package names are kept.
const applicableOverrides = Object.fromEntries(Object.entries(rootPackage.overrides || {}).filter(([name]) =>
  [...selected].some((location) => location === `node_modules/${name}` || location.endsWith(`/node_modules/${name}`)),
));
if (Object.keys(applicableOverrides).length) manifest.overrides = applicableOverrides;
let exportLock = {
  name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
  packages: { '': { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, devDependencies: manifest.devDependencies } },
};
for (const location of [...selected].sort()) exportLock.packages[location] = lock.packages[location];
// A refresh resolves the standalone application independently in an isolated scratch
// directory. Normal dev/build runs remain offline and reuse that matching lock.
const outputPath = path.join(root, 'src/lib/exporter/generated-runtime.json');
let lockVerified = false;
if (process.argv.includes('--refresh-lock')) {
  const scratch = await fs.mkdtemp(path.join(tmpdir(), 'impactor-export-lock-'));
  try {
    await fs.writeFile(path.join(scratch, 'package.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(scratch, 'package-lock.json'), JSON.stringify(exportLock));
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: scratch, stdio: 'inherit', timeout: 240_000 });
    exportLock = JSON.parse(await fs.readFile(path.join(scratch, 'package-lock.json'), 'utf8'));
    lockVerified = true;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
} else if (await exists(outputPath)) {
  const previous = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  if (JSON.stringify(previous.packageJson) === JSON.stringify(manifest) && previous.lockVerified && previous.rootLockHash === rootLockHash) {
    exportLock = previous.packageLock;
    lockVerified = true;
  }
}
const notices = [];
for (const [location, entry] of Object.entries(exportLock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!location) continue;
  notices.push(`${location} @ ${entry.version}\nDeclared license: ${entry.license || 'See dependency distribution'}\n`);
  try {
    const directory = path.join(root, location);
    const installed = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    if (installed.version !== entry.version) continue;
    const files = (await fs.readdir(directory)).filter((name) => /^(?:licen[cs]e|notice|copying)(?:\..*)?$/i.test(name));
    for (const name of files.sort()) if (await exists(path.join(directory, name))) notices.push(await fs.readFile(path.join(directory, name), 'utf8'));
  } catch { /* Platform-specific optional dependencies may not be installed here. */ }
}
const bundle = {
  formatVersion: 1,
  lockVerified,
  rootLockHash,
  files: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))),
  packageJson: manifest,
  packageLock: exportLock,
  license: await fs.readFile(path.join(root, 'LICENSE'), 'utf8'),
  thirdPartyNotices: `Dependency license notices\n\nExact package versions and registry integrity hashes are in package-lock.json.\nPlatform-specific optional dependency notices are supplied with their installed packages.\n\n${notices.join('\n---\n\n')}`,
};
await fs.mkdir(path.join(root, 'src/lib/exporter'), { recursive: true });
await fs.writeFile(path.join(root, 'src/lib/exporter/generated-runtime.json'), `${JSON.stringify(bundle)}\n`);
if (!lockVerified) console.warn('Portable dependency inputs changed: run node scripts/bundle-runtime.mjs --refresh-lock before using source export.');
console.log(`Bundled ${Object.keys(sources).length} portable runtime files and ${Object.keys(exportLock.packages).length - 1} locked packages.`);
