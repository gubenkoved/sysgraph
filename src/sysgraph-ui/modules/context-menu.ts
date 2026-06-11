export interface ContextMenuItem {
    label?: string;
    icon?: string;
    action?: () => void;
    divider?: boolean;
    disabled?: boolean;
    danger?: boolean;
    /** optional trailing pill (e.g. a warning for large example graphs) */
    badge?: {
        text: string;
        icon?: string;
        title?: string;
        tone?: 'warning';
    };
}

const menu = document.getElementById('contextMenu') as HTMLElement;

/**
 * Shows a context menu at the given screen coordinates.
 */
export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    menu.innerHTML = '';

    for (const item of items) {
        if (item.divider) {
            const el = document.createElement('div');
            el.className = 'context-menu-divider';
            menu.appendChild(el);
            continue;
        }
        const el = document.createElement('div');
        el.className = 'context-menu-item';
        if (item.danger) {
            el.classList.add('danger');
        }
        if (item.disabled) {
            el.classList.add('disabled');
        }
        if (item.icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'material-symbols-outlined';
            iconEl.textContent = item.icon;
            el.appendChild(iconEl);
        }
        const labelEl = document.createElement('span');
        labelEl.textContent = item.label ?? '';
        el.appendChild(labelEl);
        if (item.badge) {
            const badgeEl = document.createElement('span');
            badgeEl.className = 'context-menu-badge';
            if (item.badge.tone) {
                badgeEl.classList.add(item.badge.tone);
            }
            if (item.badge.title) {
                badgeEl.title = item.badge.title;
            }
            if (item.badge.icon) {
                const badgeIconEl = document.createElement('span');
                badgeIconEl.className = 'material-symbols-outlined';
                badgeIconEl.textContent = item.badge.icon;
                badgeEl.appendChild(badgeIconEl);
            }
            const badgeTextEl = document.createElement('span');
            badgeTextEl.textContent = item.badge.text;
            badgeEl.appendChild(badgeTextEl);
            el.appendChild(badgeEl);
        }
        if (!item.disabled) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                hideContextMenu();
                item.action?.();
            });
        }
        menu.appendChild(el);
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';

    // clamp to viewport
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 4}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 4}px`;
        }
    });
}

/** Hides the currently visible context menu. */
export function hideContextMenu(): void {
    menu.style.display = 'none';
}

window.addEventListener('click', () => hideContextMenu());
window.addEventListener('contextmenu', () => hideContextMenu());
