import { api } from '../api.js';

const DB_NAME = 'fieldconnect';
const DB_VERSION = 1;
const STORE = 'outcome_queue';
const FLUSH_MS = 15_000;

let started = false;
let flushTimer = null;
let flushing = false;

function supported() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  if (!supported()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'clientId' });
        store.createIndex('appointmentId', 'appointmentId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function enqueue(record) {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({
    clientId: record.clientId,
    appointmentId: record.appointmentId,
    payload: record.payload,
    createdAt: record.createdAt || new Date().toISOString(),
    attempts: record.attempts || 0,
    lastError: record.lastError || null,
  });
  await txDone(tx);
  db.close();
}

export async function removeQueued(clientId) {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(clientId);
  await txDone(tx);
  db.close();
}

export async function listQueued() {
  const db = await openDb();
  if (!db) return [];
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).getAll();
  const rows = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

async function markAttempt(clientId, lastError) {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const getReq = store.get(clientId);
  const row = await new Promise((resolve, reject) => {
    getReq.onsuccess = () => resolve(getReq.result);
    getReq.onerror = () => reject(getReq.error);
  });
  if (row) {
    row.attempts = (row.attempts || 0) + 1;
    row.lastError = lastError || null;
    store.put(row);
  }
  await txDone(tx);
  db.close();
}

async function postItem(item) {
  return api('/api/outcomes', {
    method: 'POST',
    body: item.payload,
    headers: { 'Idempotency-Key': item.clientId },
    silent: true,
  });
}

export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const items = await listQueued();
    for (const item of items) {
      try {
        const res = await postItem(item);
        if (res.status === 200 || res.status === 201) {
          await removeQueued(item.clientId);
        } else if (res.status >= 500) {
          await markAttempt(item.clientId, 'server');
        } else {
          await markAttempt(item.clientId, 'http_' + res.status);
        }
      } catch {
        await markAttempt(item.clientId, 'network');
      }
    }
  } finally {
    flushing = false;
  }
}

export function startOutcomeFlush() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (!supported()) return;
  window.addEventListener('online', () => { flushQueue(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushQueue();
  });
  flushTimer = setInterval(() => { flushQueue(); }, FLUSH_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
  flushQueue();
}

export function stopOutcomeFlush() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  started = false;
}
