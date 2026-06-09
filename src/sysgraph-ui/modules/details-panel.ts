import JSONFormatter from 'json-formatter-js';
import { EVT_GRAPH_UPDATED, EVT_LINK_CLICKED, EVT_NODE_CLICKED, PANEL_DETAILS } from './constants.js';
import { deleteEdge, deleteNode } from './edit-mode.js';
import { emit, on } from './event-bus.js';
import { closePanel, openPanel, registerPanel, unregisterPanel } from './layout.js';
import { getGraph, setGraphDirty, state } from './state.js';

// --- cached DOM elements (primary panel) ---
const body = document.getElementById('detailsPanelBody') as HTMLElement;

/** Counter used to give each secondary details panel a unique id. */
let secondaryCount = 0;


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

/** Compact reference for a node/edge: its label/name, else type, else id. */
function shortLabel(nodeOrLink: NodeOrLink): string {
    const props = nodeOrLink.properties ?? {};
    const label = (props.label ?? props.name) as string | undefined;
    return label || nodeOrLink.type || nodeOrLink.id;
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
            setGraphDirty(true);
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
            setGraphDirty(true);
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
    openPanel(PANEL_DETAILS);
}

function hideDetails(): void {
    closePanel(PANEL_DETAILS);
}

// register the primary details panel with the dock layout
registerPanel({
    id: PANEL_DETAILS,
    component: PANEL_DETAILS,
    title: 'Details',
    element: body,
    transient: true,
    // the primary panel is the live view that retargets on each click; a compact
    // pin icon on its tab hints how to spin off an independent secondary tab
    tabIcon: {
        name: 'push_pin',
        title: 'Shift-click a node or edge to pin it in a new tab',
    },
});

// --- secondary (shift-click) details panels ---
// open as additional tabs in the details group so they can be switched and
// closed freely; dockview handles drag / resize / stacking

function createSecondaryPanel(nodeOrLink: NodeOrLink): void {
    secondaryCount++;
    const id = `${PANEL_DETAILS}-${secondaryCount}`;

    const panelBody = document.createElement('div');
    panelBody.className = 'panel-body';
    const formatter = new JSONFormatter(buildDetailsData(nodeOrLink), 2);
    panelBody.appendChild(formatter.render());

    registerPanel({
        id,
        component: PANEL_DETAILS,
        // a pinned secondary tab carries the entity's own label, which reads as
        // a sleek cue against the single live "Details" primary tab
        title: shortLabel(nodeOrLink),
        element: panelBody,
        transient: true,
        position: { referencePanel: PANEL_DETAILS, direction: 'within' },
        onClose: () => unregisterPanel(id),
    });
    openPanel(id);
}

// --- event bus wiring ---

function handleClick(payload: { data: NodeOrLink; shiftKey: boolean }): void {
    if (payload.shiftKey) {
        createSecondaryPanel(payload.data);
    } else {
        showDetails(payload.data);
    }
}

on(EVT_NODE_CLICKED, handleClick);
on(EVT_LINK_CLICKED, handleClick);
