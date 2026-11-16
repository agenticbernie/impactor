import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createProject } from '@/lib/schema';
import * as repository from '@/lib/persistence';
import { loadProject, saveProject } from '@/lib/persistence';
import { useStudioStore } from './useStudioStore';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  useStudioStore.getState().setProject(createProject('Test', 'blank'));
});
describe('Studio authored state and history', () => {
  it('tracks schema only, not selection, viewport, tabs or save statuses', () => {
    const state = useStudioStore.getState(); state.addBlock('Text');
    const id = useStudioStore.getState().project.uiTree.children![0].id;
    expect(useStudioStore.getState().canUndo).toBe(true);
    state.selectBlock(id); state.setActiveTab('contracts'); state.setViewport('mobile'); state.setMode('preview');
    state.undo(); expect(useStudioStore.getState().project.uiTree.children).toEqual([]);
    expect(useStudioStore.getState().activeTab).toBe('contracts'); expect(useStudioStore.getState().viewport).toBe('mobile'); expect(useStudioStore.getState().canRedo).toBe(true);
    state.redo(); expect(useStudioStore.getState().project.uiTree.children).toHaveLength(1);
  });
  it('replaces styles so clearing one removes it', () => {
    const state = useStudioStore.getState(); const id = state.project.uiTree.id;
    state.updateBlock(id, { styles: { padding: '8px', gap: '4px' } });
    state.updateBlock(id, { styles: { gap: '4px' } });
    expect(useStudioStore.getState().project.uiTree.styles).toEqual({ gap: '4px' });
  });
  it('clones recipes, creates unique duplicate IDs, reorders and prevents cyclic nesting', () => {
    const state = useStudioStore.getState(); const before = state.project;
    state.addBlock('Container'); const id = useStudioStore.getState().selectedId!;
    state.addBlock('Text', id); state.duplicateBlock(id);
    expect(before.uiTree.children).toHaveLength(0);
    const root = useStudioStore.getState().project.uiTree;
    expect(root.children).toHaveLength(2); expect(root.children![0].id).not.toBe(root.children![1].id);
    state.moveBlock(root.children![1].id, 'up'); expect(useStudioStore.getState().project.uiTree.children![0].id).toBe(root.children![1].id);
    expect(() => state.moveBlockTo(id, id)).toThrow('itself');
  });
  it('preserves the draft after invalid import', () => {
    const before = useStudioStore.getState().project; const invalid = createProject(); invalid.uiTree.props.onclick = 'bad';
    expect(() => useStudioStore.getState().setProject(invalid)).toThrow(); expect(useStudioStore.getState().project).toBe(before);
  });
  it('groups continuous text edits into one undo operation', () => {
    const state = useStudioStore.getState();
    state.renameProject('First'); state.renameProject('Second'); state.renameProject('Final');
    expect(useStudioStore.temporal.getState().pastStates).toHaveLength(1);
    state.undo(); expect(useStudioStore.getState().project.name).toBe('Test');
    state.redo(); expect(useStudioStore.getState().project.name).toBe('Final');
  });
  it('bounds history to 100 snapshots', () => {
    for (let i = 0; i < 120; i++) useStudioStore.getState().updateProject((project) => { project.name = `Name ${i}`; });
    expect(useStudioStore.temporal.getState().pastStates).toHaveLength(100);
  });
  it('preserves memory and exposes storage errors', async () => {
    const before = useStudioStore.getState().project; vi.stubGlobal('indexedDB', undefined);
    await expect(useStudioStore.getState().save()).rejects.toThrow();
    expect(useStudioStore.getState().project).toBe(before); expect(useStudioStore.getState().saveStatus).toBe('error');
  });
  it('detects stale tabs and duplicates the in-memory draft without overwriting', async () => {
    await useStudioStore.getState().save(); const original = useStudioStore.getState().project;
    await saveProject({ ...original, name: 'Other tab' }, 1);
    useStudioStore.getState().renameProject('My draft');
    await expect(useStudioStore.getState().save()).rejects.toThrow('Another tab');
    expect(useStudioStore.getState().saveStatus).toBe('conflict'); expect(useStudioStore.getState().project.name).toBe('My draft');
    useStudioStore.getState().duplicateProject(); await useStudioStore.getState().save();
    expect(useStudioStore.getState().project.id).not.toBe(original.id); expect((await loadProject(original.id))?.project.name).toBe('Other tab');
  });
  it('prevents deleting a referenced input', () => {
    useStudioStore.getState().addBlock('Input'); const id = useStudioStore.getState().selectedId!;
    useStudioStore.getState().addBlock('Text'); const text = useStudioStore.getState().selectedId!;
    useStudioStore.getState().updateBlock(text, { bindings: { text: `{{inputs.${id}.value}}` } });
    expect(() => useStudioStore.getState().removeBlock(id)).toThrow('referencing');
  });
  it('initializes and debounces autosave after edits', async () => {
    await useStudioStore.getState().initialize();
    const save = vi.spyOn(repository, 'saveProject');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      useStudioStore.getState().renameProject('Autosaved');
      await vi.advanceTimersByTimeAsync(499); expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledOnce();
      await useStudioStore.getState().save();
      expect((await loadProject(useStudioStore.getState().project.id))?.project.name).toBe('Autosaved');
      expect(useStudioStore.getState().saveStatus).toBe('saved');
    } finally { save.mockRestore(); vi.useRealTimers(); }
  });
});
