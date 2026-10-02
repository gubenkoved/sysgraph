import { afterEach, describe, expect, it } from 'vitest';
import { getNodeVal } from './graph-ui-appearance.js';
import type { FGNode } from './graph-ui-types.js';
import { settings } from './settings.js';

const original = {
    mode: settings.nodeSizingMode,
    constant: settings.nodeSizingConstant,
    expression: settings.nodeSizingExpression,
    scale: settings.nodeSizeScale,
};
afterEach(() => {
    settings.nodeSizingMode = original.mode;
    settings.nodeSizingConstant = original.constant;
    settings.nodeSizingExpression = original.expression;
    settings.nodeSizeScale = original.scale;
});

const node = { id: 'n', type: 'test', properties: { size: 5 } } as FGNode;

describe('node sizing settings', () => {
    it('scales constant nodes from near-points to large discs', () => {
        settings.nodeSizingMode = 'constant';
        settings.nodeSizeScale = 1;
        settings.nodeSizingConstant = 0.1;
        expect(getNodeVal(node, 0)).toBeCloseTo(0.1);
        settings.nodeSizingConstant = 24;
        expect(getNodeVal(node, 0)).toBe(24);
    });

    it('applies the multiplier to degree and expression sizing', () => {
        settings.nodeSizeScale = 2;
        settings.nodeSizingMode = 'degree';
        expect(getNodeVal(node, 9)).toBe(6);
        settings.nodeSizingMode = 'expression';
        settings.nodeSizingExpression = 'properties.size';
        expect(getNodeVal(node, 0)).toBe(10);
        settings.nodeSizingExpression = 'properties.size + 1';
        expect(getNodeVal(node, 0)).toBe(12);
        settings.nodeSizingExpression = '1 +';
        expect(getNodeVal(node, 0)).toBe(2);
    });
});
