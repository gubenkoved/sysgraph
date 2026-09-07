import JSONFormatter from 'json-formatter-js';
import { parseJsonContainerString } from './details-json.js';

function renderJsonTree(data: unknown, open: number, propertiesOnly = false): HTMLElement {
    const formatter = new JSONFormatter(data, open, {
        exposePath: true,
        animateOpen: false,
        animateClose: false,
        useToJSON: false,
    });
    const tree = formatter.render();
    tree.classList.add('details-json-tree');
    const visited = new WeakSet<HTMLElement>();

    const decorateStrings = (): void => {
        for (const row of tree.querySelectorAll<HTMLElement>('.json-formatter-row[data-path]')) {
            if (visited.has(row) || row.closest('.details-json-tree') !== tree) continue;
            visited.add(row);
            const path = JSON.parse(row.dataset.path as string) as string[];
            if (propertiesOnly && (path[0] !== 'properties' || path.length < 2)) continue;
            const value = path.reduce<unknown>((parent, key) => {
                if (parent === null || typeof parent !== 'object'
                    || !Object.getOwnPropertyDescriptor(parent, key)) return undefined;
                return (parent as Record<string, unknown>)[key];
            }, data);
            const parsed = parseJsonContainerString(value);
            if (parsed === null || typeof value !== 'string') continue;
            decorateJsonString(row, value, parsed);
        }
    };

    decorateStrings();
    tree.addEventListener('click', decorateStrings);
    return tree;
}

function decorateJsonString(row: HTMLElement, original: string, parsed: unknown): void {
    const key = row.querySelector('.json-formatter-key');
    const header = document.createElement('div');
    header.className = 'details-json-header';
    if (key) header.appendChild(key);

    const marker = document.createElement('span');
    marker.className = 'details-json-marker';
    marker.textContent = 'JSON string';
    header.appendChild(marker);

    const toggle = document.createElement('md-outlined-button');
    toggle.className = 'details-json-toggle';
    header.appendChild(toggle);

    const tree = renderJsonTree(parsed, 0);
    const raw = document.createElement('pre');
    raw.className = 'details-json-raw';
    raw.hidden = true;

    const updateToggle = (): void => {
        const label = raw.hidden ? 'Show raw string' : 'Show as JSON tree';
        toggle.textContent = raw.hidden ? 'Raw' : 'JSON';
        toggle.title = label;
        toggle.setAttribute('aria-label', label);
    };
    updateToggle();
    toggle.addEventListener('click', event => {
        event.stopPropagation();
        raw.hidden = !raw.hidden;
        tree.hidden = !raw.hidden;
        if (!raw.hidden) raw.textContent = original;
        updateToggle();
    });

    row.className = 'json-formatter-row details-json-string';
    row.replaceChildren(header, tree, raw);
}

export function renderDetailsJson(data: Record<string, unknown>): HTMLElement {
    return renderJsonTree(data, 2, true);
}