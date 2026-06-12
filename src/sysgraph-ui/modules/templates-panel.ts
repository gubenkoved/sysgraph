import { PANEL_TEMPLATES } from './constants.js';
import { closePanel, openPanel, registerPanel } from './layout.js';
import { type EntityTemplate, state } from './state.js';
import { inputToValue, valueToInput } from './util.js';

// ── cached DOM elements ─────────────────────────────────────
const body = document.getElementById('templatesPanelBody') as HTMLElement;

function makeRow(labelText: string, input: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'edit-form-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(input);
    return row;
}

/**
 * Builds an editor for a single entity template. Edits mutate the given
 * template object in place, so newly created nodes/edges seed from it.
 */
function buildTemplateEditor(
    template: EntityTemplate,
    headingText: string,
    iconName: string,
): HTMLElement {
    // each template is its own card so node vs edge read as distinct sections
    const block = document.createElement('div');
    block.className = 'templates-block';

    const heading = document.createElement('div');
    heading.className = 'templates-block-title';
    const headingIcon = document.createElement('md-icon');
    headingIcon.className = 'templates-block-icon';
    headingIcon.textContent = iconName;
    const headingText_ = document.createElement('span');
    headingText_.textContent = headingText;
    heading.appendChild(headingIcon);
    heading.appendChild(headingText_);
    block.appendChild(heading);

    const form = document.createElement('div');
    form.className = 'edit-form';

    // type
    const typeInput = document.createElement('input');
    typeInput.className = 'edit-form-input';
    typeInput.value = template.type;
    typeInput.addEventListener('change', () => {
        template.type = typeInput.value.trim() || template.type;
        typeInput.value = template.type;
    });
    form.appendChild(makeRow('type', typeInput));

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
        template.properties = props;
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

    for (const [key, value] of Object.entries(template.properties)) {
        addPropRow(key, value);
    }

    addBtn.addEventListener('click', () => addPropRow('', ''));

    form.appendChild(propsSection);
    block.appendChild(form);
    return block;
}

function render(): void {
    body.innerHTML = '';

    const hint = document.createElement('p');
    hint.className = 'templates-hint';
    hint.textContent =
        'Set the type and default properties applied to the next node or edge you create in edit mode.';
    body.appendChild(hint);

    body.appendChild(buildTemplateEditor(state.edit.nodeTemplate, 'Node template', 'scatter_plot'));
    body.appendChild(buildTemplateEditor(state.edit.edgeTemplate, 'Edge template', 'arrow_right_alt'));
}

// register the templates panel with the dock layout; templates only matter in
// edit mode, so bind restore to the (non-persisted) edit tool being active
registerPanel({
    id: PANEL_TEMPLATES,
    component: PANEL_TEMPLATES,
    title: 'Templates',
    element: body,
    restoreGuard: () => state.edit.active,
    onOpen: () => render(),
});

export function openTemplatesPanel(): void {
    openPanel(PANEL_TEMPLATES);
}

export function closeTemplatesPanel(): void {
    closePanel(PANEL_TEMPLATES);
}
