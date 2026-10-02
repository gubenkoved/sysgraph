import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeStats } from './analytics-algs.js';
import { seedGeodesicGlobe } from './geodesic-layout.js';
import { Graph } from './graph.js';
import { search } from './search.js';

const globals = globalThis as unknown as Record<string, unknown>;
globals.document = { getElementById: () => null };
globals.window = { addEventListener: () => {} };
const { parseGraphData } = await import('./data-io.js');

describe('bundled large examples', () => {
    for (const [filename, nodeCount, edgeCount, query, expectedId] of [
        ['world-airline-routes', 3265, 67091, 'code:AMS', 'airport:580'],
        ['spiral-trade-routes', 21840, 87156, 'arm:Indigo', 'indigo:0'],
        ['nyc-streets', 117104, 154808, 'street:Broadway', 's1122'],
        ['us-county-migration', 3221, 254348, 'fips:06037', '06037'],
        ['debian-package-ecosystem', 76940, 487602, 'label:python3', 'python3'],
    ] as const) {
        it(`imports and searches ${filename}`, () => {
            const raw = readFileSync(new URL(`../../../data/${filename}.json`, import.meta.url), 'utf8');
            const loaded = parseGraphData(raw);
            expect(loaded.nodes).toHaveLength(nodeCount);
            expect(loaded.edges).toHaveLength(edgeCount);
            expect(loaded.skippedEdges).toBe(0);
            expect(loaded.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
            if (filename === 'spiral-trade-routes' || filename === 'nyc-streets' ||
                filename === 'debian-package-ecosystem') {
                expect(loaded.nodes.every(node => Number.isFinite(node.z))).toBe(true);
            }
            expect(loaded.display?.gpuEnablePhysics).toBe(filename === 'debian-package-ecosystem');
            if (filename === 'debian-package-ecosystem') expect(loaded.display?.layoutMode).toBe('force');
            const nodeColors = loaded.display?.nodeColors as Record<string, unknown>;
            const edgeColors = loaded.display?.edgeColors as Record<string, unknown>;
            expect(new Set(loaded.nodes.map(node => node.type))).toEqual(new Set(Object.keys(nodeColors)));
            expect(new Set(loaded.edges.map(edge => edge.type))).toEqual(new Set(Object.keys(edgeColors)));
            const graph = new Graph(loaded.nodes, loaded.edges, loaded.display);
            expect(graph.edgesMap.size).toBe(edgeCount);
            if (filename === 'nyc-streets') {
                expect(computeStats(graph).largestComponentSize / nodeCount).toBeGreaterThan(0.99);
            }
            if (filename === 'spiral-trade-routes') expect(computeStats(graph).componentCount).toBe(1);
            expect(search(graph, query).some(match => match.nodeId === expectedId)).toBe(true);
            if (filename === 'world-airline-routes' || filename === 'us-county-migration') {
                const distances = Float32Array.from(loaded.edges,
                    edge => Number(edge.properties?.distance_km) * 0.08);
                expect(seedGeodesicGlobe(loaded.nodes, loaded.edges, distances)).not.toBeNull();
            }
        }, 15_000);
    }
});
