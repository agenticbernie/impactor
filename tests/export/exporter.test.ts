import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createProject, canonicalizeProject } from '@/lib/schema';
import { exportFilename, exportProject } from '@/lib/exporter';
import bundle from '@/lib/exporter/generated-runtime.json';
import rootPackage from '../../package.json';

async function exportZip(name = 'Test export') {
  const project = createProject(name, 'blank');
  const blob = await exportProject(project);
  return { project, zip: await JSZip.loadAsync(await blob.arrayBuffer()) };
}

describe('standalone source export', () => {
  it('sanitizes dangerous and empty archive names', () => {
    for (const name of ['../../evil', '<script>alert(1)</script>', '\\..\\payload', '', 'a'.repeat(500), '你好']) {
      const result = exportFilename(name);
      expect(result).toMatch(/^[a-zA-Z0-9_-]+-source\.zip$/);
      expect(result.length).toBeLessThanOrEqual(75);
    }
  });

  it('packages source, validated JSON, exact dependency manifest, lock and license notices', async () => {
    const { project, zip } = await exportZip();
    for (const path of ['src/components/runtime/RuntimeApp.tsx', 'src/components/runtime/runtime.css', 'src/types/styles.d.ts', 'src/lib/schema/validation.ts', 'src/app/page.tsx', 'src/app/layout.tsx', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', '.env.example']) expect(zip.file(path), path).not.toBeNull();
    expect((await zip.file('project.json')!.async('string')).trim()).toBe(canonicalizeProject(project));
    expect(await zip.file('LICENSE')!.async('string')).toBe(await readFile('LICENSE', 'utf8'));
    const manifest = JSON.parse(await zip.file('package.json')!.async('string'));
    const lock = JSON.parse(await zip.file('package-lock.json')!.async('string'));
    expect(lock.packages[''].dependencies).toEqual(manifest.dependencies);
    expect(lock.packages[''].devDependencies).toEqual(manifest.devDependencies);
    expect(manifest.devDependencies['@eslint/eslintrc']).toBeDefined();
    expect(manifest.overrides.next.postcss).toBe(rootPackage.overrides.next.postcss);
    expect(manifest.overrides['@walletconnect/utils'].ws).toBe(rootPackage.overrides['@walletconnect/utils'].ws);
    expect(manifest.overrides.solc).toBeUndefined();
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
      expect(lock.packages[`node_modules/${name}`].version).toBe(version);
    }
    for (const editor of ['@dnd-kit/core', '@xyflow/react', 'jszip', 'zundo']) expect(manifest.dependencies[editor]).toBeUndefined();
    expect(Object.keys(zip.files).some((path) => /studio|ContractManager|\.test\./.test(path))).toBe(false);
  });

  it('bundles actual shared runtime source rather than a handwritten substitute', async () => {
    const { zip } = await exportZip();
    for (const path of Object.keys(bundle.files)) {
      expect(await zip.file(path)!.async('string'), path).toBe(await readFile(path, 'utf8'));
    }
  });

  it('treats hostile project names as data and never changes executable templates or paths', async () => {
    const payload = '../../bad";globalThis.pwned=true;//</script>';
    const clean = await exportZip('Normal title');
    const hostile = await exportZip(payload);
    expect(Object.keys(hostile.zip.files)).toEqual(Object.keys(clean.zip.files));
    for (const path of ['src/app/page.tsx', 'src/app/layout.tsx', 'package.json', 'next.config.ts']) {
      expect(await hostile.zip.file(path)!.async('string')).toBe(await clean.zip.file(path)!.async('string'));
    }
    expect(JSON.parse(await hostile.zip.file('project.json')!.async('string')).name).toBe(payload);
    expect(Object.keys(hostile.zip.files).some((path) => path.startsWith('/') || path.split('/').includes('..'))).toBe(false);
  });

  it('blocks invalid schema before packaging anything', async () => {
    const project = createProject('Invalid', 'blank');
    project.uiTree.props = { onClick: 'alert(1)' };
    await expect(exportProject(project)).rejects.toThrow('Cannot export invalid project');
  });
});
