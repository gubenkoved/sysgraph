import { afterEach, describe, expect, it } from 'vitest';
import { getNodeLabel } from './graph-ui-appearance.js';
import { settings } from './settings.js';

const originalMode = settings.nodeLabelMode;
const originalExpression = settings.nodeLabelExpression;

afterEach(() => {
    settings.nodeLabelMode = originalMode;
    settings.nodeLabelExpression = originalExpression;
});

describe('node label expressions', () => {
    it('reuses the expression and updates it when settings change', () => {
        settings.nodeLabelMode = 'expression';
        settings.nodeLabelExpression = 'properties.label';
        expect(getNodeLabel({ id: 'a', type: 'node', properties: { label: 'Alpha' } })).toBe('Alpha');
        expect(getNodeLabel({ id: 'b', type: 'node', properties: { label: 'Beta' } })).toBe('Beta');

        settings.nodeLabelExpression = 'id';
        expect(getNodeLabel({ id: 'b', type: 'node', properties: { label: 'Beta' } })).toBe('b');

        settings.nodeLabelExpression = '1 +';
        expect(getNodeLabel({ id: 'b', type: 'node' })).toBe('<expr error>');
        expect(getNodeLabel({ id: 'a', type: 'node' })).toBe('<expr error>');
    });
});
