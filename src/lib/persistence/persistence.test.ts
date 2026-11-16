import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createProject } from '@/lib/schema';
import { deleteProject, listProjects, listRunJournals, loadProject, RevisionConflictError, saveProject, saveRunJournal } from './index';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
describe('atomic local repository', () => {
  it('saves/reloads consistent revisions and lists and deletes projects', async () => {
    const project = createProject(); const first = await saveProject(project, null);
    expect(first.revision).toBe(1); expect((await loadProject(project.id))?.project).toEqual(project);
    project.name = 'Renamed'; const second = await saveProject(project, first.revision);
    expect(second.revision).toBe(2); expect((await listProjects())[0].name).toBe('Renamed');
    await deleteProject(project.id, 2); expect(await loadProject(project.id)).toBeUndefined();
  });
  it('serializes competing tab compare-and-writes so exactly one succeeds', async () => {
    const project = createProject(); await saveProject(project, null);
    const results = await Promise.allSettled([saveProject({ ...project, name: 'Tab A' }, 1), saveProject({ ...project, name: 'Tab B' }, 1)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(RevisionConflictError);
    expect((await loadProject(project.id))?.revision).toBe(2);
  });
  it('does not let a stale delete remove a newer revision', async () => {
    const project = createProject(); await saveProject(project, null); await saveProject(project, 1);
    await expect(deleteProject(project.id, 1)).rejects.toBeInstanceOf(RevisionConflictError);
    expect(await loadProject(project.id)).toBeDefined();
  });
  it('fails explicitly when browser storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(saveProject(createProject(), null)).rejects.toThrow('unavailable');
  });
  it('does not report success when opening storage is denied', async () => {
    vi.stubGlobal('indexedDB', { open() { throw new DOMException('Denied', 'SecurityError'); } });
    await expect(saveProject(createProject(), null)).rejects.toThrow('Denied');
  });
  it('aborts quota failures without committing a project', async () => {
    const project = createProject();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    try {
      await expect(saveProject(project, null)).rejects.toThrow('could not save');
      expect(await loadProject(project.id)).toBeUndefined();
    } finally { put.mockRestore(); }
  });
  it('journals minimal identifiers in a separate store and strips unknown data', async () => {
    const project = createProject(); await saveProject(project, null);
    const record = { id: 'run', projectId: project.id, chainId: 43113, status: 'unknown', updatedAt: 1, secretInputs: 'must not persist', transactions: [{ hash: `0x${'a'.repeat(64)}` as `0x${string}`, chainId: 43113, status: 'submitted' }] };
    await saveRunJournal(record); const journals = await listRunJournals(project.id);
    expect(journals).toHaveLength(1); expect(journals[0]).not.toHaveProperty('secretInputs'); expect(await loadProject(project.id)).not.toHaveProperty('transactions');
    await saveRunJournal({ ...record, status: 'succeeded', updatedAt: 2 }); expect((await listRunJournals(project.id))[0].status).toBe('succeeded');
    await deleteProject(project.id, 1); expect(await listRunJournals(project.id)).toEqual([]);
  });
});
