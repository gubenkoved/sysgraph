import { describe, expect, it } from 'vitest';
import { orientationFromYawPitch } from './camera-orientation.js';
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

    it('picks the front node when projected node discs overlap', () => {
        const index = new GraphInteractionIndex(Float32Array.of(
            0, 0, -100, 20,
            4, 0, 100, 20,
        ), new Uint32Array(0));
        expect(index.pick3D(400, 300, {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
        }, Float32Array.of(-100, 100), 800, 600)).toBe(1);
    });

    it('picks a large simple node when its surface is in front of a smaller node', () => {
        const index = new GraphInteractionIndex(Float32Array.of(
            0, 0, 100, 3,
            0, 0, 90, 20,
        ), new Uint32Array(0));
        expect(index.pick3D(400, 300, {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
            nodeStyle: 'simple',
        }, Float32Array.of(100, 90), 800, 600)).toBe(1);
    });

    it('picks the front node after rotating the camera to a side view', () => {
        const index = new GraphInteractionIndex(Float32Array.of(
            -100, 0, 0, 20,
            100, 0, 0, 20,
        ), new Uint32Array(0));
        expect(index.pick3D(400, 300, {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0,
            orientation: orientationFromYawPitch(Math.PI / 2, 0),
            distance: 1000, referenceDistance: 1000,
        }, Float32Array.of(0, 0), 800, 600)).toBe(1);
    });

    it('does not pick a node wholly behind the perspective near plane', () => {
        const index = new GraphInteractionIndex(Float32Array.of(0, 0, 975, 20), new Uint32Array(0));
        const camera = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
        };
        // The near plane is 50 units from the eye; this entire 20-unit-radius
        // node is closer than that plane.
        expect(index.pick3D(400, 300, camera, Float32Array.of(975), 800, 600)).toBeNull();
        expect(index.pick3D(400, 300, { ...camera, projection: 'orthographic' },
            Float32Array.of(975), 800, 600)).toBe(0);
    });

    it('picks a visible node beneath one behind the camera', () => {
        const index = new GraphInteractionIndex(Float32Array.of(
            0, 0, 1200, 20,
            0, 0, 900, 20,
        ), new Uint32Array(0));
        expect(index.pick3D(400, 300, {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
        }, Float32Array.of(1200, 900), 800, 600)).toBe(1);
    });

    it('picks the nearest visible node after dollying close to the graph', () => {
        const index = new GraphInteractionIndex(Float32Array.of(
            0, 0, 8.5, 0.2,
            0, 0, 5, 0.2,
        ), new Uint32Array(0));
        expect(index.pick3D(400, 300, {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 10, referenceDistance: 1000,
        }, Float32Array.of(8.5, 5), 800, 600)).toBe(0);
    });

    it('picks a close 3D node beyond the 2D radius limit', () => {
        const index = new GraphInteractionIndex(Float32Array.of(0, 0, 0, 20), new Uint32Array(0));
        expect(index.pick3D(650, 300, {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 50, referenceDistance: 1000,
        }, Float32Array.of(0), 800, 600)).toBe(0);
    });
});
