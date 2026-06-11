/** A trailing pill shown at the right edge of a context-menu item. */
export interface ContextMenuBadge {
    text: string;
    icon?: string;
    title?: string;
    tone?: 'info' | 'success' | 'warning';
}

export interface ContextMenuItem {
    label?: string;
    icon?: string;
    action?: () => void;
    divider?: boolean;
    disabled?: boolean;
    danger?: boolean;
    /** optional trailing pills (e.g. a "large" warning or example metadata) */
    badges?: ContextMenuBadge[];
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
        } else {
            // reserve the icon column so iconless items stay aligned with iconed ones
            const spacerEl = document.createElement('span');
            spacerEl.className = 'context-menu-icon-spacer';
            el.appendChild(spacerEl);
        }
        const labelEl = document.createElement('span');
        labelEl.textContent = item.label ?? '';
        el.appendChild(labelEl);
        if (item.badges?.length) {
            const badgesEl = document.createElement('span');
            badgesEl.className = 'context-menu-badges';
            for (const badge of item.badges) {
                const badgeEl = document.createElement('span');
                badgeEl.className = 'context-menu-badge';
                if (badge.tone) {
                    badgeEl.classList.add(badge.tone);
                }
                if (badge.title) {
                    badgeEl.title = badge.title;
                }
                if (badge.icon) {
                    const badgeIconEl = document.createElement('span');
                    badgeIconEl.className = 'material-symbols-outlined';
                    badgeIconEl.textContent = badge.icon;
                    badgeEl.appendChild(badgeIconEl);
                }
                const badgeTextEl = document.createElement('span');
                badgeTextEl.textContent = badge.text;
                badgeEl.appendChild(badgeTextEl);
                badgesEl.appendChild(badgeEl);
            }
            el.appendChild(badgesEl);
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

    // clamp to viewport (keep a small margin on every edge so a wide/tall
    // menu stays fully visible on narrow screens)
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        const margin = 4;
        if (rect.right > window.innerWidth) {
            menu.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
        }
    });
}

/** Hides the currently visible context menu. */
export function hideContextMenu(): void {
    menu.style.display = 'none';
}

window.addEventListener('click', () => hideContextMenu());
window.addEventListener('contextmenu', () => hideContextMenu());
