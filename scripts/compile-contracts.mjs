import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compilerVersion = solc.version();
const dependencyVersion = JSON.parse(await readFile(path.join(root, 'node_modules/@openzeppelin/contracts/package.json'), 'utf8')).version;
if (!compilerVersion.startsWith('0.8.38+')) throw new Error(`Expected solc 0.8.38; found ${compilerVersion}`);
if (dependencyVersion !== '5.6.1') throw new Error(`Expected OpenZeppelin 5.6.1; found ${dependencyVersion}`);
const names = ['FixedSupplyToken', 'OwnerMintNFT'];
const sources = Object.fromEntries(await Promise.all(names.map(async name => [`contracts/${name}.sol`, { content: await readFile(path.join(root, 'contracts', `${name}.sol`), 'utf8') }])));
const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', metadata: { bytecodeHash: 'ipfs', appendCBOR: true }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } } };
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings }), { import(importPath) {
  if (!importPath.startsWith('@openzeppelin/contracts/') || importPath.includes('..')) return { error: 'Import is outside the pinned dependency' };
  try { const content = readFileSync(path.join(root, 'node_modules', importPath), 'utf8'); sources[importPath] = { content }; return { contents: content }; } catch { return { error: `Missing import: ${importPath}` }; }
} }));
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if ((output.errors ?? []).some(error => error.severity === 'error')) process.exit(1);
const digest = text => createHash('sha256').update(text).digest('hex');
const outDir = path.join(root, 'src/lib/web3/artifacts');
await mkdir(outDir, { recursive: true });
for (const name of names) {
  const contract = output.contracts[`contracts/${name}.sol`][name];
  if (!contract.evm.bytecode.object) throw new Error(`No deployment bytecode for ${name}`);
  const sourceEntries = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([sourcePath, source]) => [sourcePath, { content: source.content, sha256: digest(source.content) }]));
  const artifact = {
    templateId: name === 'FixedSupplyToken' ? 'erc20-fixed-v1' : 'erc721-owner-v1', name, version: '1.0.0', license: 'MIT',
    compiler: compilerVersion, dependencies: { '@openzeppelin/contracts': dependencyVersion }, settings,
    sourcePath: `contracts/${name}.sol`, sources: sourceEntries, abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`, deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    bytecodeSha256: digest(Buffer.from(contract.evm.bytecode.object, 'hex')), sourceBundleSha256: digest(JSON.stringify(sourceEntries)),
    metadata: JSON.parse(contract.metadata),
    permissions: name === 'FixedSupplyToken' ? 'Fixed initial supply minted to the reviewed recipient. 18 decimals. No further mint authority or claim function.' : 'Initial owner can mint any unused token ID, transfer ownership or renounce ownership. No public mint or payment flow. No metadata URI management.',
    auditStatus: 'Not audited. Dependency use is not an audit.', explorerVerification: 'Not verified automatically',
  };
  await writeFile(path.join(outDir, `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`${name}: ${contract.evm.bytecode.object.length / 2} deployment bytes; sha256 ${artifact.bytecodeSha256}`);
}
