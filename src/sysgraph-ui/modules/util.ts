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
 * Returns the shared toast stack, creating it on first use. All toasts are
 * appended here (rather than directly to the body) so multiple concurrent
 * toasts stack vertically instead of overlapping at the same anchor point.
 */
function getToastStack(): HTMLDivElement {
    let stack = document.getElementById('toast-stack') as HTMLDivElement | null;
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toast-stack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    return stack;
}

/**
 * Appends a thin `.action-toast__progress` bar that shrinks left-to-right over
 * `durationMs`, hinting at the pending auto-dismiss. The shrink is driven by a
 * CSS keyframe; the duration is set inline so it matches the toast's lifetime.
 */
function appendToastProgressBar(el: HTMLDivElement, durationMs: number): void {
    const bar = document.createElement('div');
    bar.className = 'action-toast__progress';
    bar.setAttribute('aria-hidden', 'true');
    Object.assign(bar.style, {
        animationName: 'action-toast-progress',
        animationDuration: `${durationMs}ms`,
        animationTimingFunction: 'linear',
        animationFillMode: 'forwards',
    });
    el.appendChild(bar);
}

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
        position: 'relative',
        background: '#dc2626',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: UI_FONT_FAMILY,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        cursor: 'pointer',
        maxWidth: 'min(600px, calc(100vw - 32px))',
        wordBreak: 'break-word',
        // clip the auto-dismiss progress bar to the rounded corners
        overflow: 'hidden',
    });
    el.title = 'Click to dismiss';
    const remove = () => {
        el.remove();
        if (id) _activeToasts.delete(id);
    };
    el.addEventListener('click', remove);
    if (durationMs > 0) {
        const bar = document.createElement('div');
        bar.setAttribute('aria-hidden', 'true');
        Object.assign(bar.style, {
            position: 'absolute',
            left: '0',
            bottom: '0',
            width: '100%',
            height: '2px',
            background: 'rgba(255,255,255,0.55)',
            transformOrigin: 'left center',
            pointerEvents: 'none',
            animationName: 'action-toast-progress',
            animationDuration: `${durationMs}ms`,
            animationTimingFunction: 'linear',
            animationFillMode: 'forwards',
        });
        el.appendChild(bar);
    }
    getToastStack().appendChild(el);
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

/**
 * Shows a brief, theme-aware informational toast (no action button).
 * Auto-dismisses after `durationMs` (default 5 s). Reuses the `.action-toast`
 * styling so it tracks the active theme.
 */
export function showInfoToast(
    message: string,
    {
        durationMs = 5000,
        id = null,
        title = null,
        icon = 'info',
    }: {
        durationMs?: number;
        id?: string | null;
        title?: string | null;
        icon?: string | null;
    } = {},
): HTMLDivElement {
    if (id && _activeToasts.has(id)) {
        _activeToasts.get(id)!.remove();
        _activeToasts.delete(id);
    }

    const el = document.createElement('div');
    el.className = 'action-toast';
    if (id) {
        _activeToasts.set(id, el);
    }

    const remove = () => {
        el.remove();
        if (id) _activeToasts.delete(id);
    };

    if (icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'action-toast__icon material-symbols-outlined';
        iconEl.textContent = icon;
        iconEl.setAttribute('aria-hidden', 'true');
        el.appendChild(iconEl);
    }

    const body = document.createElement('div');
    body.className = 'action-toast__body';
    if (title) {
        const titleEl = document.createElement('span');
        titleEl.className = 'action-toast__title';
        titleEl.textContent = title;
        body.appendChild(titleEl);
    }
    const messageEl = document.createElement('span');
    messageEl.className = 'action-toast__message';
    messageEl.textContent = message;
    body.appendChild(messageEl);
    el.appendChild(body);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'action-toast__close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Dismiss';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.addEventListener('click', remove);
    el.appendChild(closeBtn);

    if (durationMs > 0) {
        appendToastProgressBar(el, durationMs);
    }
    getToastStack().appendChild(el);
    if (durationMs > 0) {
        setTimeout(remove, durationMs);
    }
    return el;
}

/**
 * Shows a prominent, theme-aware notification with a single primary action.
 * The toast is dismissed when the action is clicked, when the close icon is
 * clicked, or after `durationMs` (default 12 s; pass 0 to keep it sticky).
 * Styling lives in styles.css (`.action-toast`) so it tracks the active theme.
 */
export function showActionToast(
    message: string,
    actionLabel: string,
    onAction: () => void,
    {
        durationMs = 12000,
        id = null,
        title = null,
        icon = 'tune',
    }: {
        durationMs?: number;
        id?: string | null;
        title?: string | null;
        icon?: string | null;
    } = {},
): HTMLDivElement {
    if (id && _activeToasts.has(id)) {
        _activeToasts.get(id)!.remove();
        _activeToasts.delete(id);
    }

    const el = document.createElement('div');
    el.className = 'action-toast';
    if (id) {
        _activeToasts.set(id, el);
    }

    const remove = () => {
        el.remove();
        if (id) _activeToasts.delete(id);
    };

    if (icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'action-toast__icon material-symbols-outlined';
        iconEl.textContent = icon;
        iconEl.setAttribute('aria-hidden', 'true');
        el.appendChild(iconEl);
    }

    const body = document.createElement('div');
    body.className = 'action-toast__body';
    if (title) {
        const titleEl = document.createElement('span');
        titleEl.className = 'action-toast__title';
        titleEl.textContent = title;
        body.appendChild(titleEl);
    }
    const messageEl = document.createElement('span');
    messageEl.className = 'action-toast__message';
    messageEl.textContent = message;
    body.appendChild(messageEl);
    el.appendChild(body);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'action-toast__action';
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener('click', () => {
        remove();
        onAction();
    });
    el.appendChild(actionBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'action-toast__close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Dismiss';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.addEventListener('click', remove);
    el.appendChild(closeBtn);

    if (durationMs > 0) {
        appendToastProgressBar(el, durationMs);
    }
    getToastStack().appendChild(el);
    if (durationMs > 0) {
        setTimeout(remove, durationMs);
    }
    return el;
}
