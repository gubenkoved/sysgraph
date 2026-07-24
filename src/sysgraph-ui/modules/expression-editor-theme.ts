// CodeMirror theming for the expression editor. The structural theme (layout,
// caret, selection, active line) is split into light/dark variants, while the
// syntax highlight palette is driven by --cm-* design tokens defined in
// styles.css so both themes stay in sync with the app's design language.

import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const baseTheme = {
    '&': {
        fontSize: 'var(--font-size-md)',
        color: 'var(--text-primary)',
        backgroundColor: 'transparent',
    },
    '.cm-content': {
        fontFamily: 'var(--font-family-mono)',
        padding: 'var(--spacing-md) var(--spacing-md)',
        caretColor: 'var(--accent-primary)',
    },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--accent-primary)',
    },
    '.cm-scroller': {
        fontFamily: 'var(--font-family-mono)',
        lineHeight: '1.5',
    },
    '&.cm-focused': {
        outline: 'none',
    },
    '.cm-placeholder': {
        color: 'var(--text-faint)',
    },
    '.cm-tooltip': {
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        boxShadow: '0 4px 12px var(--shadow-md)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--active-button-bg)',
        color: 'var(--text-primary)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        fontFamily: 'var(--font-family-mono)',
    },
    '.cm-completionDetail': {
        color: 'var(--text-muted)',
        fontStyle: 'normal',
        fontFamily: 'var(--font-family)',
    },
};

export const cmLightTheme = EditorView.theme(
    {
        ...baseTheme,
        '.cm-selectionBackground, ::selection': {
            backgroundColor: 'rgba(26, 86, 219, 0.15)',
        },
        '&.cm-focused .cm-selectionBackground': {
            backgroundColor: 'rgba(26, 86, 219, 0.20)',
        },
    },
    { dark: false },
);

export const cmDarkTheme = EditorView.theme(
    {
        ...baseTheme,
        '.cm-selectionBackground, ::selection': {
            backgroundColor: 'rgba(120, 160, 255, 0.20)',
        },
        '&.cm-focused .cm-selectionBackground': {
            backgroundColor: 'rgba(120, 160, 255, 0.28)',
        },
    },
    { dark: true },
);

export const cmHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--cm-keyword)' },
    { tag: tags.controlKeyword, color: 'var(--cm-keyword)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--cm-string)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--cm-number)' },
    { tag: tags.propertyName, color: 'var(--cm-property)' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--cm-function)' },
    { tag: tags.variableName, color: 'var(--cm-variable)' },
    { tag: tags.operator, color: 'var(--cm-operator)' },
    { tag: tags.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
    { tag: tags.paren, color: 'var(--text-secondary)' },
    { tag: tags.punctuation, color: 'var(--text-secondary)' },
]);
