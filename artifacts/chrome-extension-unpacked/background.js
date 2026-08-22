import { contextKey, matches, normalizeUrl } from './url.js';
import { getCheckpoints, getContexts, getPending, getSnapshots, setCheckpoints, setContexts, setPending, setSnapshots, unresolvedFor } from './storage.js';
chrome.runtime.onInstalled.addListener(async () => {
    try {
        await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
    catch { }
    try {
        await chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
    catch { }
    await refreshAllTabs();
});
chrome.runtime.onStartup.addListener(() => { void handleStartup(); });
chrome.tabs.onCreated.addListener(tab => { void refreshTab(tab); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete' || changeInfo.title)
        void refreshTab({ ...tab, id: tabId });
});
chrome.tabs.onRemoved.addListener((tabId, info) => { void handleRemoved(tabId, info.isWindowClosing); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' }));
    return true;
});
async function handleStartup() {
    await refreshAllTabs();
    const pending = (await getPending()).sort((a, b) => a.closedAt.localeCompare(b.closedAt));
    if (!pending[0])
        return;
    try {
        await chrome.windows.create({ url: chrome.runtime.getURL(`checkpoint.html?pending=${encodeURIComponent(pending[0].id)}`), type: 'popup', width: 460, height: 560, focused: true });
    }
    catch { }
}
async function handleMessage(message, sender) {
    switch (message?.type) {
        case 'GET_ACTIVE_STATE': return getActiveState();
        case 'TRACK_CONTEXT': return trackContext(message.scope);
        case 'UNTRACK_CONTEXT': return untrackContext(message.contextId);
        case 'GET_PENDING_CAPTURE': return getPendingCapture(String(message.pendingId || ''));
        case 'SAVE_CHECKPOINT': return saveCheckpoint(String(message.pendingId || ''), String(message.text || ''));
        case 'DISCARD_PENDING_CAPTURE': return discardPending(String(message.pendingId || ''));
        case 'LOOKUP_CHECKPOINT': return lookupCheckpoint(String(message.url || sender?.tab?.url || ''), sender?.tab?.id);
        case 'RESOLVE_CHECKPOINT': return resolveCheckpoint(String(message.checkpointId || ''));
        case 'GET_CONTEXT_HISTORY': return getContextHistory(String(message.contextId || ''));
        default: return { ok: false, error: 'unknown_message' };
    }
}
function findBestContext(contexts, url, tabId) {
    const rank = { tab: 0, url: 1, site: 2 };
    return contexts.filter(c => matches(c, url, tabId)).sort((a, b) => rank[a.scope] - rank[b.scope] || b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}
async function getActiveTab() { const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return tabs[0] || null; }
async function getActiveState() {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url)
        return { ok: true, supported: false };
    let normalized = '';
    try {
        normalized = normalizeUrl(tab.url);
    }
    catch {
        return { ok: true, supported: false, url: tab.url, title: tab.title || '' };
    }
    const contexts = await getContexts();
    const current = findBestContext(contexts, normalized, tab.id);
    return { ok: true, supported: true, tab: { id: tab.id, url: normalized, title: tab.title || normalized, faviconUrl: tab.favIconUrl || null }, context: current };
}
async function trackContext(scope) {
    if (!['tab', 'url', 'site'].includes(scope))
        throw new Error('invalid_scope');
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url)
        throw new Error('no_active_tab');
    const url = normalizeUrl(tab.url), now = new Date().toISOString(), origin = new URL(url).origin, key = contextKey(url, scope);
    const contexts = await getContexts();
    let context = contexts.find(c => c.contextKey === key && c.scope === scope);
    if (context) {
        context = { ...context, url, origin, title: tab.title || url, faviconUrl: tab.favIconUrl || null, trackedTabId: scope === 'tab' ? tab.id : null, updatedAt: now };
        contexts.splice(contexts.findIndex(c => c.id === context.id), 1, context);
    }
    else {
        context = { id: crypto.randomUUID(), type: 'browser', contextKey: key, scope, url, origin, title: tab.title || url, faviconUrl: tab.favIconUrl || null, trackedTabId: scope === 'tab' ? tab.id : null, createdAt: now, updatedAt: now };
        contexts.push(context);
    }
    await setContexts(contexts);
    await refreshTab(tab);
    return { ok: true, context };
}
async function untrackContext(contextId) { const contexts = (await getContexts()).filter(c => c.id !== contextId); await setContexts(contexts); const snapshots = await getSnapshots(); for (const [k, v] of Object.entries(snapshots))
    if (v.contextId === contextId)
        delete snapshots[k]; await setSnapshots(snapshots); return { ok: true }; }
async function refreshAllTabs() { for (const tab of await chrome.tabs.query({}))
    await refreshTab(tab); }
async function refreshTab(tab) {
    if (!tab?.id || !tab.url)
        return;
    let url = '';
    try {
        url = normalizeUrl(tab.url);
    }
    catch {
        return;
    }
    const contexts = await getContexts();
    let context = contexts.find(c => c.scope === 'tab' && c.trackedTabId === tab.id) || findBestContext(contexts.filter(c => c.scope !== 'tab'), url, tab.id);
    if (context?.scope === 'tab' && context.trackedTabId === tab.id && context.url !== url) {
        context = { ...context, url, origin: new URL(url).origin, contextKey: contextKey(url, 'tab'), title: tab.title || url, faviconUrl: tab.favIconUrl || null, updatedAt: new Date().toISOString() };
        const i = contexts.findIndex(c => c.id === context.id);
        contexts[i] = context;
        await setContexts(contexts);
    }
    const snapshots = await getSnapshots();
    if (context) {
        snapshots[String(tab.id)] = { tabId: tab.id, contextId: context.id, url, title: tab.title || context.title || url, faviconUrl: tab.favIconUrl || context.faviconUrl, capturedAt: new Date().toISOString() };
    }
    else
        delete snapshots[String(tab.id)];
    await setSnapshots(snapshots);
}
async function handleRemoved(tabId, isWindowClosing) {
    const snapshots = await getSnapshots();
    const snapshot = snapshots[String(tabId)];
    if (!snapshot)
        return;
    delete snapshots[String(tabId)];
    await setSnapshots(snapshots);
    const contexts = await getContexts();
    const context = contexts.find(c => c.id === snapshot.contextId);
    if (!context)
        return;
    if (context.scope === 'tab' && context.trackedTabId === tabId) {
        const i = contexts.findIndex(c => c.id === context.id);
        contexts[i] = { ...context, trackedTabId: null, updatedAt: new Date().toISOString() };
        await setContexts(contexts);
    }
    const pending = { id: crypto.randomUUID(), contextId: context.id, url: snapshot.url, title: snapshot.title, closedAt: new Date().toISOString() };
    const all = await getPending();
    all.push(pending);
    await setPending(all);
    if (isWindowClosing)
        return;
    try {
        await chrome.windows.create({ url: chrome.runtime.getURL(`checkpoint.html?pending=${encodeURIComponent(pending.id)}`), type: 'popup', width: 460, height: 560, focused: true });
    }
    catch { }
}
async function getPendingCapture(id) { const pending = (await getPending()).find(x => x.id === id); if (!pending)
    return { ok: false, error: 'pending_not_found' }; const context = (await getContexts()).find(x => x.id === pending.contextId) || null; return { ok: true, pending, context }; }
async function discardPending(id) { await setPending((await getPending()).filter(x => x.id !== id)); return { ok: true }; }
async function saveCheckpoint(pendingId, text) {
    const clean = text.replace(/\u0000/g, '').trim().slice(0, 12000);
    if (!clean)
        return { ok: false, error: 'empty_checkpoint' };
    const pending = (await getPending()).find(x => x.id === pendingId);
    if (!pending)
        return { ok: false, error: 'pending_not_found' };
    const checkpoint = { id: crypto.randomUUID(), contextId: pending.contextId, originalText: clean, createdAt: new Date().toISOString(), resolvedAt: null };
    const all = await getCheckpoints();
    all.push(checkpoint);
    await setCheckpoints(all);
    await discardPending(pendingId);
    return { ok: true, checkpoint };
}
async function lookupCheckpoint(rawUrl, tabId) {
    let url = '';
    try {
        url = normalizeUrl(rawUrl);
    }
    catch {
        return { ok: true, checkpoint: null, context: null };
    }
    const contexts = await getContexts();
    const context = findBestContext(contexts, url, tabId);
    if (!context)
        return { ok: true, checkpoint: null, context: null };
    const checkpoint = (await unresolvedFor(context.id))[0] || null;
    return { ok: true, checkpoint, context };
}
async function resolveCheckpoint(id) { const all = await getCheckpoints(); const i = all.findIndex(x => x.id === id); if (i < 0)
    return { ok: false, error: 'checkpoint_not_found' }; all[i] = { ...all[i], resolvedAt: new Date().toISOString() }; await setCheckpoints(all); return { ok: true }; }
async function getContextHistory(contextId) { const context = (await getContexts()).find(c => c.id === contextId) || null; const checkpoints = (await getCheckpoints()).filter(c => c.contextId === contextId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return { ok: true, context, checkpoints }; }
