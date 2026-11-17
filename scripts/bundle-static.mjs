#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/publish-runtime');
await fs.mkdir(out, { recursive: true });
const result = await build({ absWorkingDir: root, entryPoints: ['src/lib/irys/static-entry.tsx'], outfile: path.join(out, 'app.js'), bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2022'], jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', metafile: true, write: false, loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' } });
const files = {};
for (const output of result.outputFiles) {
  const name = path.basename(output.path);
  await fs.writeFile(path.join(out, name), output.contents);
  files[name] = { bytes: output.contents.length, sha256: createHash('sha256').update(output.contents).digest('hex'), type: name.endsWith('.css') ? 'text/css' : 'text/javascript' };
}
const notices = [await fs.readFile(path.join(root, 'LICENSE'), 'utf8')];
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.add(match[1]);
}
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, directory, 'package.json'), 'utf8'));
  notices.push(`${pkg.name} ${pkg.version} — ${pkg.license || 'See license below'}`);
  for (const name of (await fs.readdir(path.join(root, directory))).filter(name => /^(licen[cs]e|notice|copying)(\..*)?$/i.test(name)).sort()) {
    const file = path.join(root, directory, name);
    if ((await fs.stat(file)).isFile()) notices.push(await fs.readFile(file, 'utf8'));
  }
}
const license = notices.join('\n\n---\n\n');
await fs.writeFile(path.join(out, 'LICENSES.txt'), license);
files['LICENSES.txt'] = { bytes: Buffer.byteLength(license), sha256: createHash('sha256').update(license).digest('hex'), type: 'text/plain' };
await fs.writeFile(path.join(root, 'src/lib/irys/generated-static.json'), JSON.stringify({ version: 1, files }) + '\n');
await build({ absWorkingDir: root, entryPoints: ['src/lib/irys/sdk-entry.ts'], outfile: path.join(out, 'sdk.js'), bundle: true, minify: true, format: 'iife', globalName: 'ImpactorStorageSDK', platform: 'browser', target: ['es2022'], define: { 'process.env.NODE_ENV': '"production"' }, plugins: [polyfillNode({ polyfills: { crypto: true } })], legalComments: 'eof' });
console.log(`Static runtime: ${Object.keys(files).join(', ')}; browser storage SDK built separately (never shipped in published apps).`);
