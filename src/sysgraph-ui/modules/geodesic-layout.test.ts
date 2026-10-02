import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seedGeodesicGlobe } from './geodesic-layout.js';
import type { FGLink, FGNode } from './graph-ui-types.js';

describe('geodesic 3D seed', () => {
    it('recovers a globe from the complete world-cities distance graph', () => {
        const graph = JSON.parse(readFileSync(new URL('../../../data/world-cities.json', import.meta.url), 'utf8')) as
            { nodes: FGNode[]; edges: FGLink[] };
        const arcs = Float32Array.from(graph.edges, edge => Number(edge.properties?.length) * 0.08);
        const result = seedGeodesicGlobe(graph.nodes, graph.edges, arcs);
        expect(result).not.toBeNull();
        expect(result!.radius).toBeGreaterThan(500);
        expect(result!.radius).toBeLessThan(520);
        let meanRelativeError = 0;
        const byId = new Map(graph.nodes.map((node, index) => [node.id, index]));
        for (let i = 0; i < graph.edges.length; i++) {
            const a = byId.get(graph.edges[i]!.source_id)!;
            const b = byId.get(graph.edges[i]!.target_id)!;
            const left = graph.nodes[a]!, right = graph.nodes[b]!;
            const actual = Math.hypot(left.x! - right.x!, left.y! - right.y!, result!.depths[a]! - result!.depths[b]!);
            meanRelativeError += Math.abs(actual / result!.chordDistances[i]! - 1);
        }
        expect(meanRelativeError / graph.edges.length).toBeLessThan(0.005);
    });

    it('does not reinterpret ordinary links as spherical distances', () => {
        const nodes = Array.from({ length: 12 }, (_, i) => ({
            id: String(i), type: 'test', properties: { lat: i, lon: i },
        }));
        const links = nodes.flatMap((node, i) => nodes.slice(i + 1).map(other => ({
            id: `${node.id}-${other.id}`, source_id: node.id, target_id: other.id, type: 'test',
        })));
        const distances = Float32Array.from(links, (_, i) => 100 + i % 7);
        expect(seedGeodesicGlobe(nodes, links, distances)).toBeNull();
    });
});
