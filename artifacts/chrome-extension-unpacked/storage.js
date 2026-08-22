const KEYS = { contexts: 'checkpoint:contexts', checkpoints: 'checkpoint:checkpoints', snapshots: 'checkpoint:tabSnapshots', pending: 'checkpoint:pendingCaptures' };
async function array(key) { const x = await chrome.storage.local.get(key); return Array.isArray(x[key]) ? x[key] : []; }
export async function getContexts() { return array(KEYS.contexts); }
export async function setContexts(v) { await chrome.storage.local.set({ [KEYS.contexts]: v }); }
export async function getCheckpoints() { return array(KEYS.checkpoints); }
export async function setCheckpoints(v) { await chrome.storage.local.set({ [KEYS.checkpoints]: v }); }
export async function getSnapshots() { const x = await chrome.storage.session.get(KEYS.snapshots); return (x[KEYS.snapshots] || {}); }
export async function setSnapshots(v) { await chrome.storage.session.set({ [KEYS.snapshots]: v }); }
export async function getPending() { return array(KEYS.pending); }
export async function setPending(v) { await chrome.storage.local.set({ [KEYS.pending]: v }); }
export async function unresolvedFor(contextId) { return (await getCheckpoints()).filter(x => x.contextId === contextId && !x.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
