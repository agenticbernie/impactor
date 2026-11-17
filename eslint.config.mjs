import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });
const config = [
  { ignores: ['next-env.d.ts', '.next/**', '.next-production/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', '.verification/**', 'src/lib/exporter/generated-runtime.*', 'src/lib/web3/artifacts/**', 'public/publish-runtime/**'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];
export default config;
