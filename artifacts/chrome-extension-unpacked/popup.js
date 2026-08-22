const stateEl = document.querySelector('#state');
const actions = document.querySelector('#actions');
void load();
async function load() { const state = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_STATE' }); if (!state?.supported) {
    stateEl.innerHTML = '<strong>Esta página no se puede seguir.</strong><p>Checkpoint funciona en páginas http/https normales.</p>';
    actions.hidden = true;
    return;
} actions.hidden = false; const tab = state.tab; const context = state.context; stateEl.innerHTML = `<div class="pageTitle">${escapeHtml(tab.title)}</div><div class="url">${escapeHtml(tab.url)}</div>${context ? `<div class="tracked">Siguiendo: <strong>${label(context.scope)}</strong></div>` : '<div class="hint">Elegí cómo querés reconocer este contexto.</div>'}`; for (const button of document.querySelectorAll('[data-scope]'))
    button.onclick = () => track(button.dataset.scope); const stop = document.querySelector('#stop'); stop.hidden = !context; stop.onclick = async () => { await chrome.runtime.sendMessage({ type: 'UNTRACK_CONTEXT', contextId: context.id }); await load(); }; }
async function track(scope) { for (const b of document.querySelectorAll('button'))
    b.disabled = true; await chrome.runtime.sendMessage({ type: 'TRACK_CONTEXT', scope }); await load(); }
function label(scope) { return scope === 'site' ? 'todo el sitio' : scope === 'url' ? 'esta URL' : 'esta pestaña'; }
function escapeHtml(v) { return v.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
export {};
