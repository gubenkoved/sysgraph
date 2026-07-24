import { beforeEach, describe, expect, it } from 'vitest';
import {
    analyticsExpressionField,
    compileField,
    edgeFilterField,
    nodeFilterField,
    nodeLabelField,
    nodeSizingField,
} from './expression-fields.js';
import {
    collectEdgePropertyKeys,
    collectNodePropertyKeys,
    describeGraphVocabulary,
} from './expression-properties.js';
import { Graph } from './graph.js';
import { settings } from './settings.js';
import { updateGraph } from './state.js';

// small graph exercising heterogeneous properties across nodes and edges
function seedGraph(): void {
    const nodes = [
        { id: 'a', type: 'process', properties: { name: 'bash', size: 4 } },
        { id: 'b', type: 'process', properties: { name: 'node', cpu: 0.5 } },
        { id: 'c', type: 'socket', properties: { label: 'lo' } },
    ];
    const edges = [
        { id: 'e1', source_id: 'a', target_id: 'b', type: 'child', properties: { weight: 3 } },
        { id: 'e2', source_id: 'b', target_id: 'c', type: 'socket', properties: {} },
    ];
    updateGraph(new Graph(nodes, edges));
}

beforeEach(() => {
    seedGraph();
});

describe('expression property discovery', () => {
    it('collects unique node property keys, sorted', () => {
        expect(collectNodePropertyKeys()).toEqual(['cpu', 'label', 'name', 'size']);
    });

    it('collects unique edge property keys, sorted', () => {
        expect(collectEdgePropertyKeys()).toEqual(['weight']);
    });
});

describe('graph vocabulary', () => {
    it('orders node types by frequency', () => {
        // two process nodes, one socket → process first
        expect(describeGraphVocabulary().nodeTypes).toEqual(['process', 'socket']);
    });

    it('breaks type frequency ties alphabetically', () => {
        // one child edge, one socket edge → alphabetical
        expect(describeGraphVocabulary().edgeTypes).toEqual(['child', 'socket']);
    });

    it('infers number vs string property kinds', () => {
        const { nodeProps } = describeGraphVocabulary();
        const byKey = Object.fromEntries(nodeProps.map((p) => [p.key, p.kind]));
        expect(byKey.size).toBe('number');
        expect(byKey.cpu).toBe('number');
        expect(byKey.name).toBe('string');
        expect(byKey.label).toBe('string');
    });

    it('treats numeric-looking strings as numbers', () => {
        updateGraph(
            new Graph(
                [{ id: 'x', type: 'city', properties: { population: '8336817' } }],
                [],
            ),
        );
        const pop = describeGraphVocabulary().nodeProps.find((p) => p.key === 'population');
        expect(pop?.kind).toBe('number');
    });
});

describe('graph-aware examples', () => {
    it('references a discovered node type in the node filter examples', () => {
        const codes = nodeFilterField().examples.map((e) => e.code);
        expect(codes).toContain('type === "process"');
    });

    it('adapts examples to a different dataset', () => {
        updateGraph(
            new Graph(
                [
                    { id: 'c1', type: 'city', properties: { name: 'Paris', population: 2148000 } },
                    { id: 'c2', type: 'city', properties: { name: 'Lyon', population: 513000 } },
                ],
                [{ id: 'r1', source_id: 'c1', target_id: 'c2', type: 'road', properties: { length: 465 } }],
            ),
        );
        const filterCodes = nodeFilterField().examples.map((e) => e.code);
        expect(filterCodes).toContain('type === "city"');
        // sizing should pick up the numeric population property
        const sizingCodes = nodeSizingField().examples.map((e) => e.code);
        expect(sizingCodes).toContain('Number(population) || 1');
        // edge weight should pick up the numeric length property
        const weightCodes = analyticsExpressionField('edgeWeightExpression', 'edge weight', '1').examples.map(
            (e) => e.code,
        );
        expect(weightCodes).toContain('Number(length) || 1');
    });

    it('exposes discovered types as suggestions', () => {
        const suggestions = edgeFilterField().suggestions();
        const typeValues = suggestions.filter((s) => s.kind === 'type').map((s) => s.insert);
        expect(typeValues).toContain('"socket"');
    });
});

describe('expression field validation', () => {
    it('rejects a syntactically invalid expression', () => {
        expect(nodeSizingField().validate('1 +')).not.toBeNull();
    });

    it('accepts a valid expression', () => {
        expect(nodeSizingField().validate('degree * 2')).toBeNull();
    });

    it('rejects an empty expression when empty is not allowed', () => {
        expect(nodeSizingField().validate('')).not.toBeNull();
    });

    it('accepts an empty expression for filters (no-op)', () => {
        expect(edgeFilterField().validate('')).toBeNull();
    });
});

describe('expression field evaluation via samples', () => {
    it('evaluates node sizing against the degree injected in scope', () => {
        const field = nodeSizingField();
        const { fn } = compileField(field, 'degree');
        const samples = field.samples(3);
        // node "b" has two incident edges → degree 2
        const bSample = samples.find((s) => s.label === 'b');
        expect(bSample).toBeDefined();
        expect(fn?.(...(bSample as { args: unknown[] }).args)).toBe(2);
    });

    it('wraps node-label results in String()', () => {
        const field = nodeLabelField();
        const { fn } = compileField(field, 'type + ":" + name');
        const aSample = field.samples(3).find((s) => s.label === 'a');
        expect(fn?.(...(aSample as { args: unknown[] }).args)).toBe('process:bash');
    });

    it('evaluates edge-weight expressions with bare property access', () => {
        const field = analyticsExpressionField('edgeWeightExpression', 'edge weight', '1');
        const { fn } = compileField(field, 'Number(weight) || 1');
        const samples = field.samples(3);
        const e1 = samples.find((s) => s.label.startsWith('a →'));
        expect(fn?.(...(e1 as { args: unknown[] }).args)).toBe(3);
    });

    it('surfaces a compile error for an invalid expression', () => {
        expect(compileField(nodeSizingField(), '1 +').error).toBeTruthy();
    });
});

describe('preview sampling', () => {
    it('returns at most the requested number of random samples drawn from the graph', () => {
        const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
        updateGraph(
            new Graph(
                ids.map((id) => ({ id, type: 'process', properties: {} })),
                [],
            ),
        );
        const samples = nodeSizingField().samples(6, true);
        expect(samples).toHaveLength(6);
        // every sampled label is a real node id
        for (const sample of samples) expect(ids).toContain(sample.label);
    });

    it('returns every entity when the graph is smaller than the limit', () => {
        updateGraph(
            new Graph(
                [
                    { id: 'a', type: 'process', properties: {} },
                    { id: 'b', type: 'process', properties: {} },
                ],
                [],
            ),
        );
        expect(nodeSizingField().samples(6, true)).toHaveLength(2);
    });
});

describe('expression field get/set roundtrip', () => {
    it('reads and writes the underlying settings value', () => {
        const original = settings.nodeSizingExpression;
        try {
            const field = nodeSizingField();
            field.setValue('degree + 1');
            expect(settings.nodeSizingExpression).toBe('degree + 1');
            expect(field.getValue()).toBe('degree + 1');
        } finally {
            settings.nodeSizingExpression = original;
        }
    });
});
