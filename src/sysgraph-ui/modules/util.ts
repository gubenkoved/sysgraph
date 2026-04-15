import { UI_FONT_FAMILY } from './constants.js';

/**
 * Computes the FNV-1a 32-bit hash of a string.
 * Returns an unsigned 32-bit hash value.
 */
export function fnv1a(str: string): number {
    let hash = 0x811c9dc5;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0; // unsigned
}

const _activeToasts = new Map<string, HTMLDivElement>();

/**
 * Shows a dismissible error toast at the bottom of the viewport.
 * Auto-dismisses after `durationMs` (default 8 s). Returns the DOM element.
 */
export function showError(
    message: string,
    { durationMs = 8000, id = null }: { durationMs?: number; id?: string | null } = {},
): HTMLDivElement {
    // If an id is given, replace any existing toast with the same id.
    if (id && _activeToasts.has(id)) {
        _activeToasts.get(id)!.remove();
        _activeToasts.delete(id);
    }
    const el = document.createElement('div');
    el.textContent = message;
    if (id) {
        _activeToasts.set(id, el);
    }
    Object.assign(el.style, {
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#dc2626',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: UI_FONT_FAMILY,
        zIndex: '9999',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        cursor: 'pointer',
        maxWidth: '600px',
        wordBreak: 'break-word',
    });
    el.title = 'Click to dismiss';
    const remove = () => {
        el.remove();
        if (id) _activeToasts.delete(id);
    };
    el.addEventListener('click', remove);
    document.body.appendChild(el);
    if (durationMs > 0) {
        setTimeout(remove, durationMs);
    }
    return el;
}

/**
 * Dismiss an active toast by its id.
 */
export function dismissError(id: string): void {
    const el = _activeToasts.get(id);
    if (el) {
        el.remove();
        _activeToasts.delete(id);
    }
}
