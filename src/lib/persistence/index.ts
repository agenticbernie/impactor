import { validateProjectDraft } from '@/lib/schema';
import type { ImpactorProjectSchema } from '@/lib/schema/types';

const DATABASE = 'impactor-local';
const VERSION = 1;
export interface ProjectRecord { id: string; project: ImpactorProjectSchema; revision: number; updatedAt: number }
export interface ProjectSummary { id: string; name: string; revision: number; updatedAt: number }
export interface RunJournal {
  id: string; projectId: string; chainId: number; status: string; updatedAt: number;
  transactions?: { hash: `0x${string}`; chainId: number; status: string }[];
}
export class RevisionConflictError extends Error {
  constructor() { super('Another tab saved a newer revision. Reload it, duplicate this draft, or download a JSON backup.'); this.name = 'RevisionConflictError'; }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Browser storage is unavailable. Keep a JSON backup of this draft.')); return; }
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('runs')) { const store = db.createObjectStore('runs', { keyPath: 'id' }); store.createIndex('projectId', 'projectId'); }
    };
    request.onerror = () => reject(new Error('Could not open browser storage. Keep a JSON backup of this draft.'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another tab. Close older tabs and retry.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
async function transaction<T>(storeName: string | string[], mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void, tx: IDBTransaction) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    let value: T;
    let failure: Error | undefined;
    try { tx = db.transaction(storeName, mode); } catch (error) { db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = () => { db.close(); reject(failure ?? new Error('Browser storage could not save this change. Keep a JSON backup and retry.')); };
    tx.onerror = () => { /* The abort handler owns rejection; never report a request as committed. */ };
    try { work(tx.objectStore(Array.isArray(storeName) ? storeName[0] : storeName), (result) => { value = result; }, (error) => { failure = error; tx.abort(); }, tx); }
    catch (error) { failure = error instanceof Error ? error : new Error('Browser storage failed.'); tx.abort(); }
  });
}
export async function saveProject(project: ImpactorProjectSchema, expectedRevision: number | null): Promise<ProjectRecord> {
  const validation = validateProjectDraft(project);
  if (!validation.success) throw new Error(`Draft cannot be saved: ${validation.issues[0]?.message}`);
  const snapshot = validation.project;
  return transaction('projects', 'readwrite', (store, done, fail) => {
    const request = store.get(snapshot.id);
    request.onsuccess = () => {
      const existing = request.result as ProjectRecord | undefined;
      if ((existing?.revision ?? null) !== expectedRevision) { fail(new RevisionConflictError()); return; }
      const record: ProjectRecord = { id: snapshot.id, project: snapshot, revision: (existing?.revision ?? 0) + 1, updatedAt: Date.now() };
      try { store.put(record); done(record); }
      catch { fail(new Error('Browser storage could not save this change. Keep a JSON backup and retry.')); }
    };
  });
}
export async function loadProject(id: string): Promise<ProjectRecord | undefined> {
  const record = await transaction<ProjectRecord | undefined>('projects', 'readonly', (store, done) => { const request = store.get(id); request.onsuccess = () => done(request.result as ProjectRecord | undefined); });
  if (!record) return undefined;
  const validation = validateProjectDraft(record.project);
  if (!validation.success || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error('The saved draft is invalid and cannot be opened.');
  return { ...record, project: validation.project };
}
export async function listProjects(): Promise<ProjectSummary[]> {
  return transaction('projects', 'readonly', (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result as ProjectRecord[]).map((record) => ({ id: record.id, name: record.project.name, revision: record.revision, updatedAt: record.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt));
  });
}
export async function deleteProject(id: string, expectedRevision?: number | null): Promise<void> {
  return transaction(['projects', 'runs'], 'readwrite', (store, done, fail, tx) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const existing = request.result as ProjectRecord | undefined;
      if (expectedRevision !== undefined && (existing?.revision ?? null) !== expectedRevision) { fail(new RevisionConflictError()); return; }
      store.delete(id);
      const journals = tx.objectStore('runs').index('projectId').openCursor(id);
      journals.onsuccess = () => { const cursor = journals.result; if (cursor) { cursor.delete(); cursor.continue(); } };
      done(undefined);
    };
  });
}
/** Only minimal reconciliation identifiers are retained; never persist arguments, account, RPC errors, or inputs. */
export async function saveRunJournal(record: RunJournal): Promise<void> {
  if (!record.id || record.id.length > 100 || !record.projectId || record.projectId.length > 100 || !Number.isSafeInteger(record.chainId) || record.chainId <= 0 || !Number.isFinite(record.updatedAt) || !/^[a-z_-]{1,40}$/.test(record.status) || (record.transactions?.length ?? 0) > 50) throw new Error('Invalid run journal.');
  const safe: RunJournal = { id: record.id, projectId: record.projectId, chainId: record.chainId, status: record.status, updatedAt: record.updatedAt };
  if (record.transactions) {
    safe.transactions = record.transactions.map((entry) => {
      if (!/^0x[\da-fA-F]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.chainId) || entry.chainId <= 0 || !/^[a-z_-]{1,40}$/.test(entry.status)) throw new Error('Invalid transaction journal.');
      return { hash: entry.hash, chainId: entry.chainId, status: entry.status };
    });
  }
  return transaction('runs', 'readwrite', (store, done) => { store.put(safe); done(undefined); });
}
export async function listRunJournals(projectId: string): Promise<RunJournal[]> {
  return transaction('runs', 'readonly', (store, done) => { const request = store.index('projectId').getAll(projectId); request.onsuccess = () => done((request.result as RunJournal[]).sort((a, b) => b.updatedAt - a.updatedAt)); });
}
export const recordRun = saveRunJournal;
export const updateRun = saveRunJournal;
