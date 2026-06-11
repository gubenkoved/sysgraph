import { describe, expect, it } from 'vitest';
import { buildScopedExpression } from './expression.js';

// mirrors how the node-label / sizing expressions are compiled: entity object
// last in the spread list so its well-known keys win over same-named properties
function evalNode(expr: string, node: Record<string, unknown>): unknown {
    const fn = buildScopedExpression(
        expr,
        ['node', 'properties'],
        ['properties', 'node'],
    );
    return fn(node, (node.properties as Record<string, unknown>) ?? {});
}

describe('buildScopedExpression - bare property access', () => {
    it('resolves a bare identifier to a property value', () => {
        const node = { id: 'C0', type: 'city', properties: { label: 'New York' } };
        expect(evalNode('label', node)).toBe('New York');
    });

    it('still supports explicit properties.* access', () => {
        const node = { id: 'C0', type: 'city', properties: { name: 'Paris' } };
        expect(evalNode('properties.name', node)).toBe('Paris');
    });

    it('exposes multiple properties as bare identifiers', () => {
        const node = {
            id: 'C0',
            type: 'city',
            properties: { name: 'Tokyo', lat: 35.68, lon: 139.65 },
        };
        expect(evalNode('name + " (" + lat + ", " + lon + ")"', node)).toBe(
            'Tokyo (35.68, 139.65)',
        );
    });

    it('supports template-literal expressions', () => {
        const node = {
            id: 'C0',
            type: 'city',
            properties: { name: 'Paris', country: 'France', lat: 48.85, lon: 2.35 },
        };
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the ${...} is the user expression under test, not a JS template
        expect(evalNode('`${name}, ${country}\\n(${lat}, ${lon})`', node)).toBe(
            'Paris, France\n(48.85, 2.35)',
        );
    });
});

describe('buildScopedExpression - well-known keys always win', () => {
    it('does not let a property named id override the node id', () => {
        const node = { id: 'real-id', type: 'city', properties: { id: 'shadow' } };
        expect(evalNode('id', node)).toBe('real-id');
    });

    it('does not let a property named type override the node type', () => {
        const node = { id: 'C0', type: 'city', properties: { type: 'shadow' } };
        expect(evalNode('type', node)).toBe('city');
    });

    it('still exposes the shadowed property via properties.*', () => {
        const node = { id: 'real-id', type: 'city', properties: { id: 'shadow' } };
        expect(evalNode('properties.id', node)).toBe('shadow');
    });
});

describe('buildScopedExpression - edge scope precedence', () => {
    // edge-weight / link-distance compile with the entity named `edge`
    function evalEdge(expr: string, edge: Record<string, unknown>): unknown {
        const fn = buildScopedExpression(
            expr,
            ['edge', 'properties'],
            ['properties', 'edge'],
        );
        return fn(edge, (edge.properties as Record<string, unknown>) ?? {});
    }

    it('does not let a property named edge shadow the edge param', () => {
        const edge = {
            id: 'e1',
            type: 'link',
            properties: { edge: 'shadow', length: 42 },
        };
        expect(evalEdge('edge.id', edge)).toBe('e1');
    });

    it('resolves a bare edge property', () => {
        const edge = { id: 'e1', type: 'link', properties: { length: 42 } };
        expect(evalEdge('Number(length) * 2', edge)).toBe(84);
    });
});

describe('buildScopedExpression - helper precedence', () => {
    it('lets a property shadow a same-named helper', () => {
        const fn = buildScopedExpression(
            'foo',
            ['node', 'properties', 'helpers'],
            ['helpers', 'properties', 'node'],
        );
        const node = { id: 'C0', type: 'city', properties: { foo: 'prop-wins' } };
        const helpers = { foo: () => 'helper' };
        expect(fn(node, node.properties, helpers)).toBe('prop-wins');
    });

    it('falls back to a helper when no property shadows it', () => {
        const fn = buildScopedExpression(
            'shout("hi")',
            ['node', 'properties', 'helpers'],
            ['helpers', 'properties', 'node'],
        );
        const node = { id: 'C0', type: 'city', properties: {} };
        const helpers = { shout: (s: string) => s.toUpperCase() };
        expect(fn(node, node.properties, helpers)).toBe('HI');
    });
});

describe('buildScopedExpression - compilation errors', () => {
    it('throws on a syntactically invalid expression', () => {
        expect(() => buildScopedExpression('a +', ['node'], ['node'])).toThrow();
    });
});
