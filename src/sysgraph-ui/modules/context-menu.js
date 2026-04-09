/**
 * @typedef {Object} ContextMenuItem
 * @property {string} [label]
 * @property {() => void} [action]
 * @property {boolean} [divider]
 */

const menu = document.getElementById('contextMenu');

/**
 * Shows a context menu at the given screen coordinates.
 * @param {number} x - Viewport X position.
 * @param {number} y - Viewport Y position.
 * @param {ContextMenuItem[]} items
 */
export function showContextMenu(x, y, items) {
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
        el.textContent = item.label;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            hideContextMenu();
            item.action();
        });
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
export function hideContextMenu() {
    menu.style.display = 'none';
}

window.addEventListener('click', () => hideContextMenu());
window.addEventListener('contextmenu', () => hideContextMenu());
