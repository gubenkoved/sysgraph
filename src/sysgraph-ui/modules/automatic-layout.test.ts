import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type AutomaticLayoutOptions, calculateAutomaticLayout } from './automatic-layout.js';
import type { FGLink, FGNode } from './graph-ui-types.js';

const node = (id: string, properties?: Record<string, unknown>): FGNode => ({ id, type: 'test', properties });
const edge = (source_id: string, target_id: string): FGLink => ({
    id: `${source_id}-${target_id}`, source_id, target_id, type: 'test',
});
const options: AutomaticLayoutOptions = {
    mode: 'layered', spacing: 90, rankSpacing: 140, direction: 'TB', rootId: '',
};
const point = (positions: Float32Array, index: number): [number, number] =>
    [positions[index * 2]!, positions[index * 2 + 1]!];

describe('automatic graph layouts', () => {
    it('layers directed flows, separates siblings, and handles cycles', () => {
        const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
        const links = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
        const positions = calculateAutomaticLayout(nodes, links, options);
        expect(point(positions, 0)[1]).toBeLessThan(point(positions, 1)[1]);
        expect(point(positions, 1)[1]).toBe(point(positions, 2)[1]);
        expect(point(positions, 3)[1]).toBeGreaterThan(point(positions, 2)[1]);
        expect(point(positions, 1)[0]).not.toBe(point(positions, 2)[0]);
        const horizontal = calculateAutomaticLayout(nodes, links, { ...options, direction: 'LR' });
        expect(point(horizontal, 0)[0]).toBeLessThan(point(horizontal, 3)[0]);

        const cycle = calculateAutomaticLayout(nodes.slice(0, 3),
            [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')], options);
        expect([...cycle].every(Number.isFinite)).toBe(true);
        expect(new Set([point(cycle, 0)[1], point(cycle, 1)[1], point(cycle, 2)[1]]).size).toBe(3);
    });

    it('uses a chosen radial root and degree center', () => {
        const nodes = ['hub', 'a', 'b', 'c', 'd'].map(id => node(id));
        const links = nodes.slice(1).map(child => edge('hub', child.id));
        const radial = calculateAutomaticLayout(nodes, links, { ...options, mode: 'radial', rootId: 'b' });
        const root = point(radial, 2);
        expect(point(radial, 0)).not.toEqual(root);
        for (let index = 0; index < nodes.length; index++) {
            if (index === 2) continue;
            expect(Math.hypot(point(radial, index)[0] - root[0], point(radial, index)[1] - root[1])).toBeGreaterThan(0);
        }
        const concentric = calculateAutomaticLayout(nodes, links, { ...options, mode: 'concentric' });
        const hub = point(concentric, 0);
        expect(Math.hypot(hub[0], hub[1])).toBeLessThan(1);
        expect(point(concentric, 1)).not.toEqual(hub);
    });

    it('places circular nodes evenly and respects pinned positions', () => {
        const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => node(id));
        nodes[2]!.x = 200; nodes[2]!.y = -100; nodes[2]!.fx = 200; nodes[2]!.fy = -100;
        const positions = calculateAutomaticLayout(nodes, nodes.slice(1).map(child => edge('a', child.id)),
            { ...options, mode: 'circular' });
        expect(point(positions, 2)).toEqual([200, -100]);
        expect(new Set(nodes.map((_, index) => point(positions, index).join(','))).size).toBe(nodes.length);
    });

    it('preserves authored grids and packs disconnected nodes without quadratic work', () => {
        const nodes = [node('00', { row: 0, col: 0 }), node('01', { row: 0, col: 1 }),
            node('10', { row: 1, col: 0 }), node('11', { row: 1, col: 1 })];
        const positions = calculateAutomaticLayout(nodes, [edge('00', '01'), edge('00', '10'), edge('01', '11')],
            { ...options, mode: 'grid' });
        expect(point(positions, 1)[0] - point(positions, 0)[0]).toBe(90);
        expect(point(positions, 2)[1] - point(positions, 0)[1]).toBe(90);
        const disconnected = calculateAutomaticLayout(nodes, [], { ...options, mode: 'grid' });
        expect(point(disconnected, 1)[0] - point(disconnected, 0)[0]).toBe(90);

        const isolated = Array.from({ length: 2000 }, (_, index) => node(`n${index}`));
        const packed = calculateAutomaticLayout(isolated, [], options);
        expect([...packed].every(Number.isFinite)).toBe(true);
        expect(new Set(isolated.map((_, index) => point(packed, index).join(','))).size).toBe(isolated.length);
    });

    it('produces finite layouts for the DNA and Fabric examples', () => {
        for (const [file, mode] of [['dna-helix', 'layered'], ['fabric', 'grid']] as const) {
            const graph = JSON.parse(readFileSync(new URL(`../../../data/${file}.json`, import.meta.url), 'utf8')) as
                { nodes: FGNode[]; edges: FGLink[] };
            const positions = calculateAutomaticLayout(graph.nodes, graph.edges, { ...options, mode });
            expect(positions.length).toBe(graph.nodes.length * 2);
            expect([...positions].every(Number.isFinite)).toBe(true);
        }
    });
});
