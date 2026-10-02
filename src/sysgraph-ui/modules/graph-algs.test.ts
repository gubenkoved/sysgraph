import { describe, expect, it } from 'vitest';
import { Graph } from './graph.js';
import { bfs } from './graph-algs.js';

describe('two-hop hover distances', () => {
    it('marks first-hop links and second-hop links separately', () => {
        const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, type: 'node' }));
        const edges = [
            ['a', 'b'], ['a', 'c'], ['b', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'e'],
        ].map(([source_id, target_id], index) => ({
            id: String(index), source_id: source_id!, target_id: target_id!, type: 'edge',
        }));
        const result = bfs(new Graph(nodes, edges), 'a', 2);

        expect(Object.fromEntries(result.nodeDistancesMap)).toEqual({ a: 0, b: 1, c: 1, d: 2 });
        expect(Object.fromEntries(result.edgeDistancesMap)).toEqual({
            '0': 1, '1': 1, '2': 2, '3': 2, '4': 2,
        });
    });
});
