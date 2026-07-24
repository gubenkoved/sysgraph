// Rich modal editor for the user-supplied expression fields. Launched from the
// edit affordance next to each expression input, it wraps a CodeMirror editor
// with JavaScript syntax highlighting, property/helper autocomplete, click-to-
// insert chips, curated examples and a live preview that evaluates the current
// expression against sample entities so the user sees real results (or errors)
// while typing. The dialog is a reused singleton reconfigured per field.

import {
    autocompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    startCompletion,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
    drawSelection,
    EditorView,
    highlightSpecialChars,
    keymap,
    placeholder,
} from '@codemirror/view';
import { EXPR_PREVIEW_SAMPLE_LIMIT } from './constants.js';
import { cmDarkTheme, cmHighlightStyle, cmLightTheme } from './expression-editor-theme.js';
import {
    compileField,
    type ExpressionField,
    type ExpressionSample,
    type ExprSuggestion,
    type SuggestionKind,
} from './expression-fields.js';
import { getTheme } from './theme.js';

// ── dom singletons ──────────────────────────────────────────

let overlay: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let editorHost: HTMLElement | null = null;
let errorEl: HTMLElement | null = null;
let previewCountEl: HTMLElement | null = null;
let previewBodyEl: HTMLElement | null = null;
let chipsEl: HTMLElement | null = null;
let examplesEl: HTMLElement | null = null;
let applyBtn: HTMLElement | null = null;
let shuffleBtn: HTMLElement | null = null;

let view: EditorView | null = null;
let activeField: ExpressionField | null = null;
// the sample entities the preview evaluates against, captured on open / shuffle
// so that typing re-evaluates the same rows instead of re-picking every keystroke
let previewSamples: ExpressionSample[] = [];

function el(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// ── autocomplete ────────────────────────────────────────────

// maps our suggestion category onto a CodeMirror completion type (drives the
// little icon + color in the popup)
function completionType(kind: SuggestionKind): string {
    switch (kind) {
        case 'property':
            return 'property';
        case 'helper':
            return 'function';
        case 'key':
            return 'keyword';
        case 'type':
            return 'type';
        default:
            return 'variable';
    }
}

function toCompletion(suggestion: ExprSuggestion): Completion {
    return {
        label: suggestion.label,
        type: completionType(suggestion.kind),
        detail: suggestion.detail,
        apply: suggestion.insert,
    };
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// members offered after `<object>.` — well-known keys of the entity/endpoint
// objects that are in scope; `properties` is handled from discovered keys
const ENTITY_MEMBERS: Record<string, string[]> = {
    node: ['id', 'type', 'properties'],
    edge: ['id', 'type', 'source_id', 'target_id', 'properties'],
    source: ['id', 'type', 'properties'],
    target: ['id', 'type', 'properties'],
};

function makeCompletionSource(field: ExpressionField) {
    const suggestions = field.suggestions();
    const options = suggestions.map(toCompletion);
    // property keys usable after a dot must be valid identifiers
    const propMembers = suggestions
        .filter((s) => s.kind === 'property' && IDENT_RE.test(s.label))
        .map((s): Completion => ({ label: s.label, type: 'property', detail: s.detail }));

    return (context: CompletionContext): CompletionResult | null => {
        // member access: `<object>.<partial>` → offer that object's members
        const dot = context.matchBefore(/([\w$]+)\.([\w$]*)$/);
        if (dot) {
            const match = /^([\w$]+)\.([\w$]*)$/.exec(dot.text);
            if (match) {
                const object = match[1] as string;
                const memberOptions =
                    object === 'properties'
                        ? propMembers
                        : ENTITY_MEMBERS[object]?.map(
                              (name): Completion => ({ label: name, type: 'keyword' }),
                          );
                if (!memberOptions) return null;
                return {
                    from: dot.from + object.length + 1,
                    options: memberOptions,
                    validFor: /^[\w$]*$/,
                };
            }
        }

        // bare identifier: the full suggestion list
        const word = context.matchBefore(/[\w$]*/);
        if (!word) return null;
        // only auto-open once the user has typed something, unless invoked explicitly
        if (word.from === word.to && !context.explicit) return null;
        return { from: word.from, options, validFor: /^[\w$]*$/ };
    };
}

// ── editor construction ─────────────────────────────────────

function buildEditor(field: ExpressionField, host: HTMLElement): EditorView {
    const dark = getTheme() === 'dark';
    return new EditorView({
        parent: host,
        state: EditorState.create({
            doc: field.getValue(),
            extensions: [
                history(),
                drawSelection(),
                highlightSpecialChars(),
                bracketMatching(),
                closeBrackets(),
                syntaxHighlighting(cmHighlightStyle),
                javascript(),
                autocompletion({ override: [makeCompletionSource(field)] }),
                placeholder('type a JavaScript expression…'),
                keymap.of([
                    // our bindings first so they win over defaultKeymap, which
                    // otherwise binds Mod-Enter (insert blank line) and Escape
                    // (simplify selection) and would shadow apply/cancel
                    {
                        key: 'Mod-Enter',
                        run: () => {
                            apply();
                            return true;
                        },
                    },
                    ...closeBracketsKeymap,
                    // completion keymap before Escape so an open popup dismisses
                    // first; only when no popup is open does Escape cancel
                    ...completionKeymap,
                    {
                        key: 'Escape',
                        run: () => {
                            close();
                            return true;
                        },
                    },
                    ...historyKeymap,
                    ...defaultKeymap,
                ]),
                EditorView.lineWrapping,
                dark ? cmDarkTheme : cmLightTheme,
                EditorView.updateListener.of((update) => {
                    if (!update.docChanged) return;
                    refreshPreview();
                    // pop member-access completion immediately after a typed '.'
                    const typed = update.transactions.some((tr) =>
                        tr.isUserEvent('input.type'),
                    );
                    if (typed) {
                        const pos = update.state.selection.main.head;
                        if (update.state.sliceDoc(pos - 1, pos) === '.') {
                            startCompletion(update.view);
                        }
                    }
                }),
            ],
        }),
    });
}

// ── chips & examples ────────────────────────────────────────

const CHIP_GROUP_ORDER: SuggestionKind[] = ['property', 'type', 'key', 'variable', 'helper'];
const CHIP_GROUP_LABEL: Record<SuggestionKind, string> = {
    property: 'properties',
    type: 'types',
    key: 'keys',
    variable: 'variables',
    helper: 'helpers',
};

function insertAtCursor(text: string): void {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    // place the caret inside a helper's parentheses so the user types the arg
    const caret = text.endsWith('()') ? from + text.length - 1 : from + text.length;
    view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: caret },
    });
    view.focus();
}

function renderChips(field: ExpressionField): void {
    if (!chipsEl) return;
    chipsEl.replaceChildren();
    const grouped = new Map<SuggestionKind, ExprSuggestion[]>();
    for (const suggestion of field.suggestions()) {
        const list = grouped.get(suggestion.kind) ?? [];
        list.push(suggestion);
        grouped.set(suggestion.kind, list);
    }
    for (const kind of CHIP_GROUP_ORDER) {
        const list = grouped.get(kind);
        if (!list || list.length === 0) continue;
        const group = el('div', 'expr-editor-chip-group');
        group.appendChild(el('div', 'expr-editor-chip-title', CHIP_GROUP_LABEL[kind]));
        const wrap = el('div', 'expr-editor-chip-wrap');
        for (const suggestion of list) {
            const chip = el('button', `expr-editor-chip chip-${kind}`, suggestion.label);
            chip.title = suggestion.detail;
            chip.addEventListener('click', () => insertAtCursor(suggestion.insert));
            wrap.appendChild(chip);
        }
        group.appendChild(wrap);
        chipsEl.appendChild(group);
    }
}

function renderExamples(field: ExpressionField): void {
    if (!examplesEl) return;
    examplesEl.replaceChildren();
    examplesEl.appendChild(el('div', 'expr-editor-chip-title', 'examples'));
    for (const example of field.examples) {
        const row = el('button', 'expr-editor-example');
        row.appendChild(el('code', 'expr-editor-example-code', example.code));
        row.appendChild(el('span', 'expr-editor-example-desc', example.desc));
        row.title = 'insert this example';
        row.addEventListener('click', () => {
            if (!view) return;
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: example.code,
                },
            });
            view.focus();
        });
        examplesEl.appendChild(row);
    }
}

// ── live preview ────────────────────────────────────────────

// (re)captures the sample entities the preview runs against; `random` draws a
// fresh random subset (the shuffle button), otherwise the field's default
// selection-first set
function resamplePreview(random: boolean): void {
    previewSamples = activeField
        ? activeField.samples(EXPR_PREVIEW_SAMPLE_LIMIT, random)
        : [];
    refreshPreview();
}

function refreshPreview(): void {
    if (!view || !activeField || !previewBodyEl || !previewCountEl || !errorEl || !applyBtn) {
        return;
    }
    const expr = view.state.doc.toString();
    const validationError = activeField.validate(expr);

    // toggle Apply + the error banner on validity
    applyBtn.toggleAttribute('disabled', validationError !== null);
    if (validationError) {
        errorEl.textContent = validationError;
        errorEl.hidden = false;
    } else {
        errorEl.hidden = true;
    }

    // shuffling only makes sense when the graph has more entities than we show;
    // a short sample means we already show everything there is
    shuffleBtn?.toggleAttribute(
        'disabled',
        previewSamples.length < EXPR_PREVIEW_SAMPLE_LIMIT,
    );

    previewBodyEl.replaceChildren();

    // an empty (allowed) expression has nothing meaningful to preview
    if (!expr.trim()) {
        previewCountEl.textContent = '';
        previewBodyEl.appendChild(el('div', 'expr-editor-preview-empty', 'no expression'));
        return;
    }

    const compiled = compileField(activeField, expr);
    if (compiled.error || !compiled.fn) {
        previewCountEl.textContent = '';
        previewBodyEl.appendChild(
            el('div', 'expr-editor-preview-empty', 'fix the error to preview'),
        );
        return;
    }

    if (previewSamples.length === 0) {
        previewCountEl.textContent = '';
        previewBodyEl.appendChild(
            el('div', 'expr-editor-preview-empty', 'load a graph to preview'),
        );
        return;
    }
    previewCountEl.textContent = `${previewSamples.length} sample${previewSamples.length === 1 ? '' : 's'}`;

    for (const sample of previewSamples) {
        const row = el('div', 'expr-editor-preview-row');
        const key = el('span', 'expr-editor-preview-key', sample.label);
        key.title = sample.title;
        row.appendChild(key);
        try {
            const result = compiled.fn(...sample.args);
            row.appendChild(
                el('span', 'expr-editor-preview-val', activeField.formatResult(result)),
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'error';
            row.appendChild(el('span', 'expr-editor-preview-val error', msg));
        }
        previewBodyEl.appendChild(row);
    }
}

// ── open / close / apply ────────────────────────────────────

function ensureDom(): void {
    if (overlay) return;

    overlay = el('div', 'dialog-overlay expr-editor-overlay');
    overlay.hidden = true;

    const dialog = el('div', 'dialog expr-editor');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // header
    const header = el('div', 'dialog-header');
    titleEl = el('span', 'dialog-title', 'Edit expression');
    const closeBtn = document.createElement('md-icon-button');
    closeBtn.setAttribute('title', 'Close');
    const closeIcon = document.createElement('md-icon');
    closeIcon.textContent = 'close';
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener('click', close);
    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // body: editor + preview on the left, chips + examples on the right
    const body = el('div', 'dialog-body expr-editor-body');

    const left = el('div', 'expr-editor-left');
    editorHost = el('div', 'expr-editor-host');
    errorEl = el('div', 'expr-editor-error');
    errorEl.hidden = true;

    const previewBlock = el('div', 'expr-editor-preview');
    const previewHeader = el('div', 'expr-editor-preview-header');
    previewHeader.appendChild(el('span', 'expr-editor-preview-label', 'live preview'));
    const previewMeta = el('div', 'expr-editor-preview-meta');
    previewCountEl = el('span', 'expr-editor-preview-count');
    shuffleBtn = document.createElement('md-icon-button');
    shuffleBtn.className = 'expr-editor-shuffle';
    shuffleBtn.setAttribute('title', 'Shuffle preview samples');
    shuffleBtn.setAttribute('aria-label', 'Shuffle preview samples');
    const shuffleIcon = document.createElement('md-icon');
    shuffleIcon.textContent = 'shuffle';
    shuffleBtn.appendChild(shuffleIcon);
    shuffleBtn.addEventListener('click', () => resamplePreview(true));
    previewMeta.appendChild(previewCountEl);
    previewMeta.appendChild(shuffleBtn);
    previewHeader.appendChild(previewMeta);
    previewBodyEl = el('div', 'expr-editor-preview-body');
    previewBlock.appendChild(previewHeader);
    previewBlock.appendChild(previewBodyEl);

    left.appendChild(editorHost);
    left.appendChild(errorEl);
    left.appendChild(previewBlock);

    const right = el('div', 'expr-editor-right');
    chipsEl = el('div', 'expr-editor-chips');
    examplesEl = el('div', 'expr-editor-examples');
    right.appendChild(chipsEl);
    right.appendChild(examplesEl);

    body.appendChild(left);
    body.appendChild(right);

    // footer
    const footer = el('div', 'dialog-footer expr-editor-footer');
    footer.appendChild(el('span', 'expr-editor-hint', 'Ctrl/⌘+Enter to apply · Esc to cancel'));
    const actions = el('div', 'expr-editor-actions');
    const cancelBtn = document.createElement('md-text-button');
    cancelBtn.className = 'expr-editor-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    applyBtn = document.createElement('md-filled-tonal-button') as HTMLElement;
    applyBtn.className = 'expr-editor-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', apply);
    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);
    footer.appendChild(actions);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // dismiss on backdrop click / Escape
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        // CodeMirror owns Escape while the editor is focused (it dismisses an
        // open autocomplete popup first, then cancels); only act as a fallback
        // when focus is elsewhere, e.g. on the Apply/Cancel buttons
        if (editorHost?.contains(event.target as Node)) return;
        close();
    });
}

function apply(): void {
    if (!view || !activeField) return;
    const expr = view.state.doc.toString();
    if (activeField.validate(expr) !== null) return;
    activeField.setValue(expr);
    close();
}

function close(): void {
    if (!overlay) return;
    overlay.hidden = true;
    view?.destroy();
    view = null;
    activeField = null;
    previewSamples = [];
}

/** Opens the rich expression editor bound to the given field descriptor. */
export function openExpressionEditor(field: ExpressionField): void {
    ensureDom();
    if (!overlay || !editorHost || !titleEl) return;

    activeField = field;
    titleEl.textContent = `Edit ${field.title.toLowerCase()} expression`;

    // rebuild the editor fresh so it binds the new field's value + scope
    view?.destroy();
    editorHost.replaceChildren();
    view = buildEditor(field, editorHost);

    renderChips(field);
    renderExamples(field);
    // capture the default (selection-first) sample set, then render the preview
    resamplePreview(false);

    overlay.hidden = false;
    view.focus();
}

/**
 * Builds a compact edit icon-button that opens the rich expression editor for
 * the field returned by `makeField`. The factory is called on click so the
 * editor always binds the current value + freshly-discovered properties.
 */
export function createExpressionEditTrigger(
    makeField: () => ExpressionField,
): HTMLElement {
    const trigger = document.createElement('md-icon-button');
    trigger.className = 'expr-edit-trigger';
    trigger.setAttribute('title', 'Open expression editor');
    trigger.setAttribute('aria-label', 'Open expression editor');
    const icon = document.createElement('md-icon');
    icon.textContent = 'edit';
    trigger.appendChild(icon);
    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        openExpressionEditor(makeField());
    });
    return trigger;
}
