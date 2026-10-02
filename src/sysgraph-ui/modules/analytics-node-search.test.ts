import { describe, expect, it } from 'vitest';
import { findNodeCandidates } from './analytics-node-search.js';
import { Graph } from './graph.js';

const visible = new Graph([
    { id: 'alpha', type: 'process', properties: { name: 'worker one', user: 'root' } },
    { id: 'beta', type: 'process', properties: { name: 'worker two', user: 'alice' } },
    { id: 'gamma', type: 'socket', properties: { name: 'worker three', user: 'root' } },
]);

describe('analytics node candidates', () => {
    it('uses the toolbar search grammar on the supplied visible graph', () => {
        const result = findNodeCandidates(visible, 'type:process user:root');
        expect(result.nodes.map(node => node.id)).toEqual(['alpha']);
        expect(result.total).toBe(1);
        expect(result.error).toBeNull();
    });

    it('limits displayed nodes while keeping the full match count', () => {
        const result = findNodeCandidates(visible, 'worker', 2);
        expect(result.nodes).toHaveLength(2);
        expect(result.total).toBe(3);
    });

    it('returns syntax errors for inline feedback', () => {
        const result = findNodeCandidates(visible, 'unknown_field:value');
        expect(result.nodes).toEqual([]);
        expect(result.error).toMatch(/No searchable fields/);
    });

    it('treats a graph without visible nodes as an empty result', () => {
        expect(findNodeCandidates(new Graph(), 'type:process')).toEqual({
            nodes: [], total: 0, error: null,
        });
    });
});
