export function normalizeUrl(raw) {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol))
        throw new Error('unsupported_url');
    u.hash = '';
    if (u.pathname.length > 1)
        u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
}
export function contextKey(raw, scope) {
    const normalized = normalizeUrl(raw);
    const u = new URL(normalized);
    return scope === 'site' ? `browser:site:${u.origin.toLowerCase()}` : `browser:url:${normalized}`;
}
export function matches(context, raw, tabId) {
    try {
        const normalized = normalizeUrl(raw);
        if (context.scope === 'tab' && context.trackedTabId === tabId)
            return true;
        if (context.scope === 'site')
            return new URL(normalized).origin === context.origin;
        return normalizeUrl(context.url) === normalized;
    }
    catch {
        return false;
    }
}
