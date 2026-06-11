// Shared help popover for the user-supplied expression fields (node label,
// node sizing, link distance, edge weight). A single popover element is reused
// for every trigger; it is positioned next to whichever help icon was clicked
// and explains, generically, how expressions are evaluated.

interface HelpRow {
    code: string;
    desc: string;
}

interface HelpBlock {
    title: string;
    rows: HelpRow[];
}

// one generic explanation reused across every expression field
const HELP_BLOCKS: HelpBlock[] = [
    {
        title: 'How it works',
        rows: [
            {
                code: 'JavaScript',
                desc: 'each expression is a JS expression evaluated per node or edge',
            },
            {
                code: 'properties',
                desc: 'every property is also available as a bare name',
            },
            {
                code: 'id, type',
                desc: 'well-known keys always win over a same-named property',
            },
        ],
    },
    {
        title: 'In scope',
        rows: [
            { code: 'node / edge', desc: 'the whole item (id, type, properties, …)' },
            { code: 'properties.x', desc: 'a property by explicit path' },
            { code: 'x', desc: 'the same property as a bare name' },
            { code: 'source, target', desc: 'resolved endpoint nodes (edge expressions)' },
        ],
    },
    {
        title: 'Helpers',
        rows: [
            { code: 'bytes_to_human(n)', desc: 'format a byte count, e.g. 2.0 KiB' },
        ],
    },
    {
        title: 'Examples',
        rows: [
            { code: 'label', desc: 'show the label property' },
            { code: 'name + "\\n" + type', desc: 'name, then type on a second line' },
            { code: 'Number(length) || 1', desc: 'numeric property with a fallback' },
        ],
    },
];

let popover: HTMLElement | null = null;
let currentTrigger: HTMLElement | null = null;

function el(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function buildContent(): HTMLElement {
    const root = el('div', 'expr-help-content');
    for (const block of HELP_BLOCKS) {
        const blockEl = el('div', 'help-block');
        blockEl.appendChild(el('div', 'help-block-title', block.title));
        for (const row of block.rows) {
            const rowEl = el('div', 'help-row');
            rowEl.appendChild(el('code', 'help-code', row.code));
            rowEl.appendChild(el('span', 'help-desc', row.desc));
            blockEl.appendChild(rowEl);
        }
        root.appendChild(blockEl);
    }
    return root;
}

function ensurePopover(): HTMLElement {
    if (popover) return popover;
    popover = el('div', 'expr-help-popover');
    popover.appendChild(buildContent());
    document.body.appendChild(popover);

    // dismiss on outside click
    document.addEventListener('click', (e) => {
        if (!popover?.classList.contains('open')) return;
        const target = e.target as Node;
        if (popover.contains(target) || currentTrigger?.contains(target)) return;
        close();
    });
    // dismiss on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });
    // reposition / dismiss on scroll & resize (fixed positioning would drift)
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return popover;
}

function position(trigger: HTMLElement): void {
    if (!popover) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    // measure to keep the popover on-screen
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    let left = rect.right - pw;
    if (left < margin) left = margin;
    if (left + pw > window.innerWidth - margin) {
        left = window.innerWidth - margin - pw;
    }
    let top = rect.bottom + margin;
    if (top + ph > window.innerHeight - margin) {
        // not enough room below: flip above the trigger
        top = Math.max(margin, rect.top - margin - ph);
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
}

function close(): void {
    popover?.classList.remove('open');
    currentTrigger = null;
}

function toggle(trigger: HTMLElement): void {
    const popoverEl = ensurePopover();
    if (popoverEl.classList.contains('open') && currentTrigger === trigger) {
        close();
        return;
    }
    currentTrigger = trigger;
    popoverEl.classList.add('open');
    position(trigger);
}

/**
 * Creates a small help icon-button that toggles the shared expression-help
 * popover anchored to itself. Reused next to every expression input.
 */
export function createExpressionHelpTrigger(): HTMLElement {
    const trigger = document.createElement('md-icon-button');
    trigger.className = 'expr-help-trigger';
    trigger.setAttribute('title', 'How expressions are evaluated');
    trigger.setAttribute('aria-label', 'Expression help');
    const icon = document.createElement('md-icon');
    icon.textContent = 'help';
    trigger.appendChild(icon);
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(trigger);
    });
    return trigger;
}
