import JSONFormatter from 'json-formatter-js';
import { EVT_GRAPH_UPDATED, EVT_LINK_CLICKED, EVT_NODE_CLICKED } from './constants.js';
import { deleteEdge, deleteNode } from './edit-mode.js';
import { emit, on } from './event-bus.js';
import { getGraph, state } from './state.js';

// --- cached DOM elements (primary panel) ---
const panel = document.getElementById('detailsPanel') as HTMLElement;
const body = document.getElementById('detailsPanelBody') as HTMLElement;
const closeBtn = document.getElementById('detailsPanelClose') as HTMLElement;
const content = document.getElementById('content') as HTMLElement;

/** Counter used to cascade floating panel positions. */
let floatingPanelCount = 0;

interface NodeOrLink {
    id: string;
    type: string;
    kind: string;
    source_id?: string;
    target_id?: string;
    properties?: Record<string, unknown>;
}

function buildDetailsData(nodeOrLink: NodeOrLink): Record<string, unknown> {
    return {
        id: nodeOrLink.id,
        type: nodeOrLink.type,
        kind: nodeOrLink.kind,
        properties: nodeOrLink.properties ?? {},
    };
}

// ---------------------------------------------------------------------------
// Editable form (edit mode)
// ---------------------------------------------------------------------------

/** Serializes a property value for display in an input field. */
function valueToInput(value: unknown): string {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

/** Parses an input string back into a value (JSON with string fallback). */
function inputToValue(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed === '') return '';
    try {
        return JSON.parse(trimmed);
    } catch {
        return text;
    }
}

function makeRow(labelText: string, input: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'edit-form-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(input);
    return row;
}

function makeReadonlyInput(value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'edit-form-input';
    input.value = value;
    input.disabled = true;
    return input;
}

function buildEditableForm(nodeOrLink: NodeOrLink): HTMLElement {
    const isEdge = nodeOrLink.kind === 'edge';
    const form = document.createElement('div');
    form.className = 'edit-form';

    // id (read-only)
    form.appendChild(makeRow('id', makeReadonlyInput(nodeOrLink.id)));

    // type (editable)
    const typeInput = document.createElement('input');
    typeInput.className = 'edit-form-input';
    typeInput.value = nodeOrLink.type;
    typeInput.addEventListener('change', () => {
        const newType = typeInput.value.trim() || (isEdge ? 'edge' : 'node');
        const target = isEdge ? getGraph().getEdge(nodeOrLink.id) : getGraph().getNode(nodeOrLink.id);
        if (target) {
            target.type = newType;
            nodeOrLink.type = newType;
            emit(EVT_GRAPH_UPDATED, null);
        }
    });
    form.appendChild(makeRow('type', typeInput));

    if (isEdge) {
        form.appendChild(makeRow('source', makeReadonlyInput(nodeOrLink.source_id ?? '')));
        form.appendChild(makeRow('target', makeReadonlyInput(nodeOrLink.target_id ?? '')));
    }

    // properties editor
    const propsSection = document.createElement('div');
    propsSection.className = 'edit-form-props';

    const propsHeader = document.createElement('div');
    propsHeader.className = 'edit-form-props-header';
    const propsTitle = document.createElement('span');
    propsTitle.textContent = 'properties';
    const addBtn = document.createElement('md-icon-button') as HTMLElement;
    addBtn.title = 'Add property';
    const addIcon = document.createElement('md-icon');
    addIcon.textContent = 'add';
    addBtn.appendChild(addIcon);
    propsHeader.appendChild(propsTitle);
    propsHeader.appendChild(addBtn);
    propsSection.appendChild(propsHeader);

    const rowsContainer = document.createElement('div');
    rowsContainer.className = 'edit-prop-rows';
    propsSection.appendChild(rowsContainer);

    const commitProperties = (): void => {
        const props: Record<string, unknown> = {};
        for (const row of Array.from(rowsContainer.children)) {
            const keyInput = row.querySelector('.edit-prop-key') as HTMLInputElement;
            const valInput = row.querySelector('.edit-prop-value') as HTMLInputElement;
            const key = keyInput.value.trim();
            if (key === '') continue;
            props[key] = inputToValue(valInput.value);
        }
        const target = isEdge ? getGraph().getEdge(nodeOrLink.id) : getGraph().getNode(nodeOrLink.id);
        if (target) {
            target.properties = props;
            nodeOrLink.properties = props;
            emit(EVT_GRAPH_UPDATED, null);
        }
    };

    const addPropRow = (key: string, value: unknown): void => {
        const row = document.createElement('div');
        row.className = 'edit-prop-row';

        const keyInput = document.createElement('input');
        keyInput.className = 'edit-form-input edit-prop-key';
        keyInput.placeholder = 'key';
        keyInput.value = key;

        const valInput = document.createElement('input');
        valInput.className = 'edit-form-input edit-prop-value';
        valInput.placeholder = 'value';
        valInput.value = valueToInput(value);

        const removeBtn = document.createElement('md-icon-button') as HTMLElement;
        removeBtn.title = 'Remove property';
        const removeIcon = document.createElement('md-icon');
        removeIcon.textContent = 'close';
        removeBtn.appendChild(removeIcon);
        removeBtn.addEventListener('click', () => {
            row.remove();
            commitProperties();
        });

        keyInput.addEventListener('change', commitProperties);
        valInput.addEventListener('change', commitProperties);

        row.appendChild(keyInput);
        row.appendChild(valInput);
        row.appendChild(removeBtn);
        rowsContainer.appendChild(row);
    };

    const properties = nodeOrLink.properties ?? {};
    for (const [key, value] of Object.entries(properties)) {
        addPropRow(key, value);
    }

    addBtn.addEventListener('click', () => addPropRow('', ''));

    form.appendChild(propsSection);

    // delete action
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'edit-form-delete';
    deleteBtn.textContent = isEdge ? 'Delete edge' : 'Delete node';
    deleteBtn.addEventListener('click', () => {
        if (isEdge) {
            deleteEdge(nodeOrLink.id);
        } else {
            deleteNode(nodeOrLink.id);
        }
        hideDetails();
    });
    form.appendChild(deleteBtn);

    return form;
}

function showDetails(nodeOrLink: NodeOrLink): void {
    body.innerHTML = '';
    if (state.edit.active) {
        body.appendChild(buildEditableForm(nodeOrLink));
    } else {
        const formatter = new JSONFormatter(buildDetailsData(nodeOrLink), 2);
        body.appendChild(formatter.render());
    }
    panel.classList.add('open');
}

function hideDetails(): void {
    panel.classList.remove('open');
}

closeBtn.addEventListener('click', () => hideDetails());

// --- drag support (reusable) ---

function attachDrag(panelEl: HTMLElement): void {
    const header = panelEl.querySelector('.panel-header') as HTMLElement;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('pointerdown', (e) => {
        if ((e.target as Element).closest('md-icon-button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = panelEl.offsetLeft;
        startTop = panelEl.offsetTop;
        header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const parent = panelEl.parentElement!;
        const x = Math.max(0, Math.min(startLeft + e.clientX - startX, parent.clientWidth - panelEl.offsetWidth));
        const y = Math.max(0, Math.min(startTop + e.clientY - startY, parent.clientHeight - panelEl.offsetHeight));
        panelEl.style.left = `${x}px`;
        panelEl.style.top = `${y}px`;
    });

    header.addEventListener('pointerup', () => { dragging = false; });
}

// attach drag to the primary panel
attachDrag(panel);

// --- floating (shift-click) panels ---

function createFloatingPanel(nodeOrLink: NodeOrLink): void {
    floatingPanelCount++;
    const offset = 8 + floatingPanelCount * 30;

    const el = document.createElement('div');
    el.className = 'details-panel open';
    el.style.top = `${offset}px`;
    el.style.left = `${offset}px`;

    const header = document.createElement('div');
    header.className = 'panel-header';

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = 'Details';

    const closeButton = document.createElement('md-icon-button') as HTMLElement;
    const closeIcon = document.createElement('md-icon') as HTMLElement;
    closeIcon.textContent = 'close';
    closeButton.appendChild(closeIcon);
    closeButton.addEventListener('click', () => {
        el.remove();
        floatingPanelCount = Math.max(0, floatingPanelCount - 1);
    });

    header.appendChild(title);
    header.appendChild(closeButton);

    const panelBody = document.createElement('div');
    panelBody.className = 'panel-body';
    const formatter = new JSONFormatter(buildDetailsData(nodeOrLink), 2);
    panelBody.appendChild(formatter.render());

    el.appendChild(header);
    el.appendChild(panelBody);
    content.appendChild(el);

    attachDrag(el);
}

// --- event bus wiring ---

function handleClick(payload: { data: NodeOrLink; shiftKey: boolean }): void {
    if (payload.shiftKey) {
        createFloatingPanel(payload.data);
    } else {
        showDetails(payload.data);
    }
}

on(EVT_NODE_CLICKED, handleClick);
on(EVT_LINK_CLICKED, handleClick);
