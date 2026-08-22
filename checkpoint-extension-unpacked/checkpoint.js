"use strict";
const params = new URLSearchParams(location.search);
const pendingId = params.get('pending') || '';
const title = document.querySelector('#title');
const meta = document.querySelector('#meta');
const text = document.querySelector('#text');
const statusEl = document.querySelector('#status');
const save = document.querySelector('#save');
const skip = document.querySelector('#skip');
void init();
async function init() { const result = await chrome.runtime.sendMessage({ type: 'GET_PENDING_CAPTURE', pendingId }); if (!result?.ok) {
    title.textContent = 'Este checkpoint ya no está pendiente.';
    meta.textContent = 'Podés cerrar esta ventana.';
    text.hidden = true;
    save.hidden = true;
    skip.textContent = 'Cerrar';
    skip.onclick = () => window.close();
    return;
} title.textContent = '¿Dónde quedaste?'; meta.textContent = result.pending.title || result.pending.url; text.focus(); save.onclick = async () => { const value = text.value.trim(); if (!value) {
    statusEl.textContent = 'Escribí una frase corta antes de guardar.';
    return;
} setBusy(true); const res = await chrome.runtime.sendMessage({ type: 'SAVE_CHECKPOINT', pendingId, text: value }); if (res?.ok) {
    statusEl.textContent = 'Guardado. Va a reaparecer cuando vuelvas.';
    setTimeout(() => window.close(), 550);
}
else {
    statusEl.textContent = 'No se pudo guardar. Probá de nuevo.';
    setBusy(false);
} }; skip.onclick = async () => { await chrome.runtime.sendMessage({ type: 'DISCARD_PENDING_CAPTURE', pendingId }); window.close(); }; }
function setBusy(v) { save.disabled = v; skip.disabled = v; text.disabled = v; }
