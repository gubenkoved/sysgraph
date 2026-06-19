import { describe, expect, it } from 'vitest';
import {
    makeEdgeFilterFn,
    makeNodeFilterFn,
    validateEdgeFilterExpression,
    validateNodeFilterExpression,
} from './graph-ui-appearance.js';
import type { FGLink, FGNode } from './graph-ui-types.js';

function node(props: Record<string, unknown>, type = 'process'): FGNode {
    return { id: 'n', type, kind: 'node', properties: props } as unknown as FGNode;
}

function edge(props: Record<string, unknown>, type = 'socket'): FGLink {
    return {
        id: 'e',
        type,
        kind: 'edge',
        source_id: 'a',
        target_id: 'b',
        properties: props,
    } as unknown as FGLink;
}

describe('makeNodeFilterFn', () => {
    it('keeps a node when the expression is truthy', () => {
        const fn = makeNodeFilterFn('cpu_user > 0');
        expect(fn(node({ cpu_user: 5 }), 0)).toBe(true);
        expect(fn(node({ cpu_user: 0 }), 0)).toBe(false);
    });

    it('exposes node keys and degree in scope', () => {
        const fn = makeNodeFilterFn('type === "process" && degree >= 2');
        expect(fn(node({}, 'process'), 2)).toBe(true);
        expect(fn(node({}, 'process'), 1)).toBe(false);
        expect(fn(node({}, 'socket'), 5)).toBe(false);
    });

    it('keeps every node (fail-open) when the expression does not compile', () => {
        const fn = makeNodeFilterFn('cpu_user >');
        expect(fn(node({ cpu_user: 5 }), 0)).toBe(true);
    });

    it('excludes a node when evaluation throws at runtime', () => {
        const fn = makeNodeFilterFn('missing.deep.value > 0');
        expect(fn(node({}), 0)).toBe(false);
    });
});

describe('validateNodeFilterExpression', () => {
    it('returns null for a valid expression', () => {
        expect(validateNodeFilterExpression('degree > 1')).toBeNull();
    });

    it('returns an error message for an invalid expression', () => {
        expect(validateNodeFilterExpression('degree >')).not.toBeNull();
    });
});

describe('makeEdgeFilterFn', () => {
    it('keeps an edge when the expression is truthy', () => {
        const fn = makeEdgeFilterFn('weight > 1');
        expect(fn(edge({ weight: 5 }))).toBe(true);
        expect(fn(edge({ weight: 0 }))).toBe(false);
    });

    it('exposes edge keys in scope', () => {
        const fn = makeEdgeFilterFn('type === "socket"');
        expect(fn(edge({}, 'socket'))).toBe(true);
        expect(fn(edge({}, 'pipe'))).toBe(false);
    });

    it('keeps every edge (fail-open) when the expression does not compile', () => {
        const fn = makeEdgeFilterFn('weight >');
        expect(fn(edge({ weight: 5 }))).toBe(true);
    });

    it('excludes an edge when evaluation throws at runtime', () => {
        const fn = makeEdgeFilterFn('missing.deep.value > 0');
        expect(fn(edge({}))).toBe(false);
    });
});

describe('validateEdgeFilterExpression', () => {
    it('returns null for a valid expression', () => {
        expect(validateEdgeFilterExpression('weight > 1')).toBeNull();
    });

    it('returns an error message for an invalid expression', () => {
        expect(validateEdgeFilterExpression('weight >')).not.toBeNull();
    });
});
