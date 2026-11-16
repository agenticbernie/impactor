'use client';

import { create } from 'zustand';
import { temporal } from 'zundo';
import { canonicalizeProject, createBlock, createProject, findBlock, flattenBlocks, validateProject } from '@/lib/schema';
import type { BlockType, ImpactorProjectSchema, UIBlockNode } from '@/lib/schema/types';
import * as repository from '@/lib/persistence';

export interface StudioState {
  project: ImpactorProjectSchema;
  selectedId: string | null;
  activeTab: 'ui' | 'workflow' | 'contracts';
  mode: 'edit' | 'preview';
  viewport: 'desktop' | 'mobile';
  saveStatus: 'loading' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  setProject: (project: ImpactorProjectSchema) => void;
  updateProject: (recipe: (draft: ImpactorProjectSchema) => void) => void;
  selectBlock: (id: string | null) => void;
  setActiveTab: (tab: StudioState['activeTab']) => void;
  setMode: (mode: StudioState['mode']) => void;
  setViewport: (viewport: StudioState['viewport']) => void;
  addBlock: (type: BlockType, parentId?: string) => void;
  updateBlock: (id: string, patch: Partial<UIBlockNode>) => void;
  removeBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  moveBlock: (id: string, direction: 'up' | 'down') => void;
  moveBlockTo: (id: string, parentId: string) => void;
  renameProject: (name: string) => void;
  undo: () => void;
  redo: () => void;
  initialize: () => Promise<void>;
  save: () => Promise<void>;
  newProject: (template?: 'token' | 'blank') => Promise<void>;
  duplicateProject: () => void;
  listProjects: () => Promise<repository.ProjectSummary[]>;
  openProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}
let revision: number | null = null;
let generation = 0;
let initialized = false;
let initializing: Promise<void> | undefined;
let inFlight: Promise<void> | undefined;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let replacing = false;
let lastEdit: { key: string; at: number; project: ImpactorProjectSchema } | undefined;

function groupedEdit(key: string, recipe: (draft: ImpactorProjectSchema) => void) {
  const history = useStudioStore.temporal.getState();
  const now = Date.now();
  const coalesce = history.isTracking && lastEdit?.key === key && lastEdit.project === useStudioStore.getState().project && now - lastEdit.at < 400 && history.futureStates.length === 0;
  if (coalesce) history.pause();
  try {
    useStudioStore.getState().updateProject(recipe);
    lastEdit = { key, at: now, project: useStudioStore.getState().project };
  } finally { if (coalesce) history.resume(); }
}

function parentOf(root: UIBlockNode, id: string): UIBlockNode | undefined {
  return flattenBlocks(root).find((block) => block.children?.some((child) => child.id === id));
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Browser storage failed. Download a JSON backup.'; }
function scheduleSave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  if (!initialized || ['error', 'conflict'].includes(useStudioStore.getState().saveStatus)) return;
  autosaveTimer = setTimeout(() => { void useStudioStore.getState().save().catch(() => { /* Status exposes failure; the draft remains in memory. */ }); }, 500);
}
function replaceProject(project: ImpactorProjectSchema, nextRevision: number | null, saved: boolean) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  generation++;
  lastEdit = undefined;
  revision = nextRevision;
  replacing = true;
  const history = useStudioStore.temporal.getState();
  history.pause();
  useStudioStore.setState({ project, selectedId: null, mode: 'edit', saveStatus: saved ? 'saved' : 'dirty', saveError: null });
  history.clear(); history.resume();
  replacing = false;
  if (!saved) scheduleSave();
}

export const useStudioStore = create<StudioState>()(temporal((set, get) => ({
  project: createProject(), selectedId: null, activeTab: 'ui', mode: 'edit', viewport: 'desktop',
  saveStatus: 'loading', saveError: null, canUndo: false, canRedo: false,
  setProject(project) {
    const result = validateProject(project);
    if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    // Imports are a new local copy; they cannot overwrite an existing ID with an unknown revision.
    replaceProject({ ...result.project, id: crypto.randomUUID() }, null, false);
  },
  updateProject(recipe) {
    const draft = structuredClone(get().project);
    recipe(draft);
    // Assert JSON-safe authored data immediately; semantic drafts may remain incomplete.
    canonicalizeProject(draft);
    if (draft.id !== get().project.id) throw new Error('Use project lifecycle actions to change project identity.');
    set({ project: draft });
  },
  selectBlock(id) { set({ selectedId: id && findBlock(get().project.uiTree, id) ? id : null }); },
  setActiveTab(activeTab) { set({ activeTab }); },
  setMode(mode) { set({ mode }); },
  setViewport(viewport) { set({ viewport }); },
  addBlock(type, parentId) {
    const block = createBlock(type);
    get().updateProject((project) => {
      const target = findBlock(project.uiTree, parentId ?? get().selectedId ?? project.uiTree.id);
      const parent = target?.type === 'Container' ? target : target ? parentOf(project.uiTree, target.id) : project.uiTree;
      if (!parent || parent.type !== 'Container') throw new Error('Choose a container to add a block.');
      (parent.children ??= []).push(block);
    });
    set({ selectedId: block.id });
  },
  updateBlock(id, patch) {
    groupedEdit(`block:${id}:${Object.keys(patch).sort().join(',')}`, (project) => {
      const block = findBlock(project.uiTree, id);
      if (!block) return;
      if (patch.id && patch.id !== id) throw new Error('Block IDs cannot be changed.');
      Object.assign(block, patch, { id });
    });
  },
  removeBlock(id) {
    if (id === get().project.uiTree.id) throw new Error('The root container cannot be deleted.');
    const original = findBlock(get().project.uiTree, id);
    if (!original) return;
    const ids = new Set(flattenBlocks(original).map((block) => block.id));
    const otherBlocks = flattenBlocks(get().project.uiTree).filter((block) => !ids.has(block.id));
    const references = JSON.stringify({ workflows: get().project.workflows, blocks: otherBlocks.map((block) => ({ props: block.props, bindings: block.bindings })) });
    if (get().project.workflows.nodes.some((node) => node.type === 'ui_trigger' && ids.has(node.config.blockId)) || [...ids].some((key) => references.includes(`{{inputs.${key}.value}}`))) throw new Error('Remove workflow or input bindings referencing this block before deleting it.');
    get().updateProject((project) => { const parent = parentOf(project.uiTree, id); if (parent?.children) parent.children = parent.children.filter((block) => block.id !== id); });
    if (get().selectedId && ids.has(get().selectedId!)) set({ selectedId: null });
  },
  duplicateBlock(id) {
    let selected: string | undefined;
    get().updateProject((project) => {
      const source = findBlock(project.uiTree, id); const parent = parentOf(project.uiTree, id);
      if (!source || !parent?.children) throw new Error('Select a non-root block to duplicate.');
      const copy = structuredClone(source);
      const mappings = new Map(flattenBlocks(copy).map((block) => [block.id, crypto.randomUUID()]));
      for (const block of flattenBlocks(copy)) block.id = mappings.get(block.id)!;
      let serialized = JSON.stringify(copy);
      for (const [oldId, newId] of mappings) serialized = serialized.replaceAll(`{{inputs.${oldId}.value}}`, `{{inputs.${newId}.value}}`);
      const rewritten = JSON.parse(serialized) as UIBlockNode;
      parent.children.splice(parent.children.findIndex((block) => block.id === id) + 1, 0, rewritten);
      selected = rewritten.id;
    });
    if (selected) set({ selectedId: selected });
  },
  moveBlock(id, direction) {
    get().updateProject((project) => {
      const parent = parentOf(project.uiTree, id); if (!parent?.children) return;
      const index = parent.children.findIndex((block) => block.id === id); const target = index + (direction === 'up' ? -1 : 1);
      if (target < 0 || target >= parent.children.length) return;
      [parent.children[index], parent.children[target]] = [parent.children[target], parent.children[index]];
    });
  },
  moveBlockTo(id, parentId) {
    get().updateProject((project) => {
      const node = findBlock(project.uiTree, id); const oldParent = parentOf(project.uiTree, id); const parent = findBlock(project.uiTree, parentId);
      if (!node || !oldParent || parent?.type !== 'Container') throw new Error('Only non-root blocks can be moved into containers.');
      if (findBlock(node, parentId)) throw new Error('A block cannot be nested inside itself or a descendant.');
      oldParent.children = oldParent.children!.filter((block) => block.id !== id); (parent.children ??= []).push(node);
    });
  },
  renameProject(name) {
    if (!name.trim() || name.length > 100) throw new Error('Project name must contain 1–100 characters.');
    groupedEdit('project-name', (project) => { project.name = name.trim(); });
  },
  undo() { lastEdit = undefined; useStudioStore.temporal.getState().undo(); },
  redo() { lastEdit = undefined; useStudioStore.temporal.getState().redo(); },
  async initialize() {
    if (initialized) return;
    if (initializing) return initializing;
    const before = get().project;
    initializing = (async () => {
      try {
        const projects = await repository.listProjects();
        const record = projects[0] ? await repository.loadProject(projects[0].id) : undefined;
        if (get().project === before) {
          if (record) replaceProject(record.project, record.revision, true);
          else set({ saveStatus: 'dirty' });
        }
        initialized = true;
        if (get().saveStatus !== 'saved') await get().save();
      } catch (error) { initialized = true; set({ saveStatus: 'error', saveError: errorMessage(error) }); }
      finally { initializing = undefined; }
    })();
    return initializing;
  },
  async save() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    while (inFlight) { await inFlight; if (get().saveStatus === 'saved') return; }
    const snapshot = get().project; const currentGeneration = generation; const expected = revision;
    set({ saveStatus: 'saving', saveError: null });
    const operation = (async () => {
      try {
        const record = await repository.saveProject(snapshot, expected);
        if (generation !== currentGeneration) return;
        revision = record.revision;
        const unchanged = get().project === snapshot;
        set({ saveStatus: unchanged ? 'saved' : 'dirty', saveError: null });
        if (!unchanged) scheduleSave();
      } catch (error) {
        if (generation === currentGeneration) set({ saveStatus: error instanceof repository.RevisionConflictError ? 'conflict' : 'error', saveError: errorMessage(error) });
        throw error;
      }
    })();
    inFlight = operation;
    try { await operation; } finally { if (inFlight === operation) inFlight = undefined; }
  },
  async newProject(template = 'token') {
    if (get().saveStatus !== 'saved') await get().save();
    replaceProject(createProject(undefined, template), null, false);
  },
  duplicateProject() {
    const project = structuredClone(get().project);
    project.id = crypto.randomUUID(); project.name = `${project.name.slice(0, 93)} (copy)`;
    replaceProject(project, null, false);
  },
  listProjects: repository.listProjects,
  async openProject(id) {
    // Reopening the conflicted project is the explicit reload/recovery operation.
    if (id !== get().project.id && get().saveStatus !== 'saved') await get().save();
    const record = await repository.loadProject(id);
    if (!record) throw new Error('This local project no longer exists.');
    replaceProject(record.project, record.revision, true);
  },
  async deleteProject(id) {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    if (inFlight) await inFlight;
    await repository.deleteProject(id, id === get().project.id ? revision : undefined);
    if (id === get().project.id) replaceProject(createProject(), null, false);
    else if (get().saveStatus === 'dirty') scheduleSave();
  },
}), {
  partialize: (state) => ({ project: state.project }),
  equality: (past, current) => past.project === current.project || canonicalizeProject(past.project) === canonicalizeProject(current.project),
  limit: 100,
}));

useStudioStore.temporal.subscribe((history) => {
  useStudioStore.setState({ canUndo: history.pastStates.length > 0, canRedo: history.futureStates.length > 0 });
});
useStudioStore.subscribe((state, previous) => {
  if (replacing || state.project === previous.project) return;
  const failed = state.saveStatus === 'conflict';
  useStudioStore.setState({
    saveStatus: failed ? state.saveStatus : 'dirty',
    saveError: failed ? state.saveError : null,
    selectedId: state.selectedId && findBlock(state.project.uiTree, state.selectedId) ? state.selectedId : null,
  });
  scheduleSave();
});
