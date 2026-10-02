import { describe, expect, it } from 'vitest';

const globals = globalThis as unknown as Record<string, unknown>;
globals.document = { getElementById: () => null };
globals.window = { addEventListener: () => {} };

const { parseGraphData } = await import('./data-io.js');

describe('large example import', () => {
    it('resolves indexed edges and keeps authored node positions and edge properties', () => {
        const loaded = parseGraphData(JSON.stringify({
            edgeEncoding: 'indexed-v1',
            edgeTypes: ['route'],
            edgeProperties: ['distance_km', 'airline'],
            nodes: [
                { id: 'AMS', type: 'airport', x: 12.5, y: -3, properties: { city: 'Amsterdam' } },
                { id: 'LHR', type: 'airport', x: -6, y: -2, properties: { city: 'London' } },
            ],
            edges: [[0, 1, 0, 370, 'KL'], [0, 3, 0, 120, 'KL']],
        }));

        expect(loaded.nodes[0]).toMatchObject({ id: 'AMS', x: 12.5, y: -3,
            properties: { city: 'Amsterdam' } });
        expect(loaded.nodes[0]?.properties).not.toHaveProperty('x');
        expect(loaded.edges).toEqual([{
            id: 'edge:0', source_id: 'AMS', target_id: 'LHR', type: 'route',
            properties: { distance_km: 370, airline: 'KL' },
        }]);
        expect(loaded.skippedEdges).toBe(1);
    });

    it('rejects malformed indexed edge tuples', () => {
        expect(() => parseGraphData(JSON.stringify({
            edgeEncoding: 'indexed-v1', edgeTypes: ['route'], edgeProperties: [],
            nodes: [{ id: 'AMS' }], edges: [[0, 0, 9]],
        }))).toThrow('Invalid indexed edge at position 0.');
    });
});
