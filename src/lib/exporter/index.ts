import JSZip from 'jszip';
import { canonicalizeProject, validateProject } from '@/lib/schema';
import type { ImpactorProjectSchema } from '@/lib/schema/types';
import runtimeBundle from './generated-runtime.json';

/** Used for the browser download only; names never select archive paths. */
export function exportFilename(name: string): string {
  const safe = name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return `${safe || 'impactor-dapp'}-source.zip`;
}

const page = `'use client';

import { RuntimeApp } from '@/components/runtime/RuntimeApp';
import { validateProject } from '@/lib/schema';
import snapshot from '../../project.json';

const result = validateProject(snapshot);

export default function Page() {
  if (!result.success) return <main><h1>Invalid project snapshot</h1><p>Validate project.json before running this app.</p></main>;
  return <RuntimeApp project={result.project} />;
}
`;
const layout = `import type { ReactNode } from 'react';
import '@/components/runtime/runtime.css';
import './globals.css';

export const metadata = { title: 'Standalone dApp', description: 'A schema-driven Avalanche application' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`;
const readme = `# Standalone Avalanche dApp

This application contains the exact portable runtime sources bundled with Impactor and a validated project.json snapshot. It does not load code from hosted Impactor or require an Impactor account. Schema data is not executable source.

## Setup

1. Install Node.js 22 LTS (or a supported newer LTS) and npm.
2. Review project.json, especially public RPC URL, network, contract addresses, ABIs, and transaction values. Project authors and contracts are not automatically trustworthy.
3. Run npm ci. Dependencies and their integrity hashes are pinned in package-lock.json.
4. The bundled provider uses injected-wallet discovery; no WalletConnect relay or project ID is currently required. .env.example documents public-only configuration boundaries. Adding a relay requires a deliberate provider-code change and compatibility testing; setting an environment variable alone does not enable it. Never place private keys, seed phrases, service secrets or unrestricted private RPC credentials in this app.
5. Run npm run typecheck, npm run lint, and npm run build.
6. Run npm run dev for local development, or npm start after building. Open http://localhost:3000.

## Operation and limitations

- The app needs an external HTTPS RPC service and, for signing, a compatible browser wallet. RPC URLs and NEXT_PUBLIC_* values are browser-visible public configuration. Apply provider origin restrictions where available.
- Execution and deployments are Fuji-first; Mainnet and custom-L1 writes are not enabled. A contract address/ABI is not a security audit or source verification.
- Connecting a wallet, switching networks, and signing must be deliberate user actions. No wallet keys or sessions are included in this export.
- Runtime input, wallet context and run journals are not exported. Authored initial values ARE public data: inspect them before sharing or deploying.
- Irys funding/upload/publication is disabled because the current browser-wallet, payment-chain/asset, fees and retrieval guarantees have not been verified. This app is hosted by your chosen Next.js host, not by a JSON storage gateway.
- Wallet compatibility, real Fuji transactions, accessibility of authored content, RPC availability, dependency security and deployment operations require your own verification. This is not an automatically audited or production-ready application.
- A submitted transaction cannot be undone by closing this page. Receipt uncertainty is not proof of failure; do not blindly submit again.

## Source and licenses

src/components/runtime, src/lib/schema, src/lib/engine and the referenced provider/Web3 modules are shared runtime source, not a separate generated interpreter. project.json is the authored configuration. No Studio editor, browser-local drafts or live Impactor code fetches are required.

LICENSE contains the upstream MIT notice. THIRD_PARTY_NOTICES.txt records bundled dependency license notices; package-lock.json records exact versions. Installed optional platform dependencies supply their own notices. Review all applicable dependency/contract notices before distribution. Exporting an application's configuration does not grant rights to third-party brands, assets or contracts.
`;

/** Validates before packaging; all executable templates and archive paths are fixed. */
export async function exportProject(project: ImpactorProjectSchema): Promise<Blob> {
  const result = validateProject(project);
  if (!result.success) throw new Error(`Cannot export invalid project: ${result.issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  if (runtimeBundle.formatVersion !== 1 || !Object.keys(runtimeBundle.files).length) throw new Error('Portable runtime bundle is unavailable. Rebuild Impactor before exporting.');
  if (!runtimeBundle.lockVerified) throw new Error('The portable dependency lock needs refresh. Run node scripts/bundle-runtime.mjs --refresh-lock, then rebuild Impactor.');
  const zip = new JSZip();
  const fixedDate = new Date('2000-01-01T00:00:00.000Z');
  const add = (path: string, contents: string) => {
    if (!/^[a-zA-Z0-9_@./-]+$/.test(path) || path.startsWith('/') || path.split('/').some((segment) => segment === '..')) throw new Error('Unsafe runtime archive path.');
    zip.file(path, contents, { date: fixedDate, createFolders: false });
  };
  for (const [path, source] of Object.entries(runtimeBundle.files).sort(([a], [b]) => a.localeCompare(b))) add(path, source);
  add('project.json', `${canonicalizeProject(result.project)}\n`);
  add('package.json', `${JSON.stringify(runtimeBundle.packageJson, null, 2)}\n`);
  add('package-lock.json', `${JSON.stringify(runtimeBundle.packageLock, null, 2)}\n`);
  add('src/app/page.tsx', page);
  add('src/app/layout.tsx', layout);
  add('src/app/globals.css', ':root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;color:#182237}button,input,select,textarea{font:inherit}@media(prefers-color-scheme:dark){body{background:#101724;color:#eef2fa}}\n');
  add('tsconfig.json', `${JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }], paths: { '@/*': ['./src/*'] } }, include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'], exclude: ['node_modules'] }, null, 2)}\n`);
  add('next-env.d.ts', '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
  add('next.config.ts', "import type { NextConfig } from 'next';\nconst config: NextConfig = { reactStrictMode: true };\nexport default config;\n");
  add('eslint.config.mjs', "import { FlatCompat } from '@eslint/eslintrc';\nimport { fileURLToPath } from 'node:url';\nconst compat = new FlatCompat({ baseDirectory: fileURLToPath(new URL('.', import.meta.url)) });\nexport default [...compat.extends('next/core-web-vitals', 'next/typescript'), { ignores: ['.next/**', 'out/**', 'next-env.d.ts'] }];\n");
  add('.gitignore', 'node_modules/\n.next/\nout/\n.env*\n!.env.example\n*.tsbuildinfo\n');
  add('.env.example', '# Public configuration only. Never put private keys or service secrets here.\n# If enabling a wallet relay, use a public, origin-restricted project ID.\n# NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=\n# The public RPC endpoint is configured in project.json.\n');
  add('README.md', readme);
  add('LICENSE', runtimeBundle.license);
  add('THIRD_PARTY_NOTICES.txt', runtimeBundle.thirdPartyNotices);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' });
}
