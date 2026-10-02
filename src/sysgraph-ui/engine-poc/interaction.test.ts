import { describe, expect, it } from 'vitest';
import { GraphInteractionIndex } from './interaction.js';

describe('hover neighborhood', () => {
    it('keeps direct and two-hop nodes distinct across cycles and parallel edges', () => {
        const nodes = new Float32Array(5 * 4);
        const edges = new Uint32Array([
            0, 0, 0, 1, 0, 1, 0, 2, 1, 3, 2, 3, 3, 4,
        ]);
        const index = new GraphInteractionIndex(nodes, edges);

        const fromZero = index.getNeighborhood(0);
        expect([...fromZero.firstHop]).toEqual([1, 2]);
        expect([...fromZero.secondHop]).toEqual([3]);

        const fromThree = index.getNeighborhood(3);
        expect([...fromThree.firstHop]).toEqual([1, 2, 4]);
        expect([...fromThree.secondHop]).toEqual([0]);
        expect([...index.getNeighborhood(0).secondHop]).toEqual([3]);
    });
});

describe('large node picking', () => {
    it('finds the visible edge of a large node in 2D and 3D', () => {
        const index = new GraphInteractionIndex(Float32Array.of(0, 0, 0, 30), new Uint32Array(0));
        expect(index.pick(25, 0, 1)).toBe(0);
        expect(index.pick3D(425, 300, {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
        }, Float32Array.of(0), 800, 600)).toBe(0);
    });
});
