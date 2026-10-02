import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FGLink, FGNode } from './graph-ui-types.js';
import { seedInitialLayout } from './initial-layout.js';

function example(name: string): { nodes: FGNode[]; edges: FGLink[]; display: Record<string, unknown> } {
    return JSON.parse(readFileSync(new URL(`../../../data/${name}.json`, import.meta.url), 'utf8'));
}

const profile = { charge: -40, linkStrength: 0.9, collisionMultiplier: 0,
    velocityDecay: 0.5, forceXYStrength: 0.1 };

describe('authored example layout seeds', () => {
    it('keeps the DNA base pairs in sequence with close bond lengths', () => {
        const graph = example('dna-helix');
        const distances = Float32Array.from(graph.edges, edge => Number(edge.properties?.length) * 2.5);
        expect(seedInitialLayout(graph.nodes, graph.edges, distances, profile)).toBe('paired-strands');
        const byId = new Map(graph.nodes.map(node => [node.id, node]));
        const relativeError = graph.edges.reduce((total, edge, index) => {
            const source = byId.get(edge.source_id)!;
            const target = byId.get(edge.target_id)!;
            return total + Math.abs(Math.hypot(source.x! - target.x!, source.y! - target.y!) / distances[index]! - 1);
        }, 0) / graph.edges.length;
        expect(relativeError).toBeLessThan(0.2);
        for (let pair = 0; pair < 22; pair++) {
            const left = byId.get(`S0_${pair}`)!;
            const right = byId.get(`S1_${pair}`)!;
            expect(Math.hypot(left.x! - right.x!, left.y! - right.y!)).toBeCloseTo(50, 3);
        }
    });

    it('keeps Fabric on its 40 by 40 lattice at the authored spacing', () => {
        const graph = example('fabric');
        const distances = Float32Array.from(graph.edges, edge => Number(edge.properties?.length));
        expect(seedInitialLayout(graph.nodes, graph.edges, distances,
            { ...profile, collisionMultiplier: 1, forceXYStrength: 0 })).toBe('grid');
        const byId = new Map(graph.nodes.map(node => [node.id, node]));
        const first = byId.get('0-0')!;
        const right = byId.get('0-1')!;
        const below = byId.get('1-0')!;
        expect(right.x! - first.x!).toBeCloseTo(26, 5);
        expect(below.y! - first.y!).toBeCloseTo(26, 5);
        expect(byId.get('39-39')!.x! - first.x!).toBeCloseTo(1014, 5);
    });
});
