import { describe, expect, it } from 'vitest';
import { gridPlaneBounds } from './grid-plane.js';

describe('3D grid plane bounds', () => {
    it('uses fixed square world bounds around a shifted graph with a generous margin', () => {
        const nodes = Float32Array.of(
            12_000, -21_000, 500, 4,
            16_000, -19_000, -700, 8,
        );
        expect([...gridPlaneBounds(nodes)]).toEqual([14_000, -20_000, 12_000, 12_000]);
    });

    it('ignores invalid XY positions and uses a minimum extent for small graphs', () => {
        const nodes = Float32Array.of(
            NaN, 0, 0, 1,
            40, Infinity, 0, 1,
            -100, 200, 0, 1,
            100, 300, 0, 1,
        );
        expect([...gridPlaneBounds(nodes)]).toEqual([0, 250, 5000, 5000]);
    });

    it('centers an empty or entirely invalid graph at the world origin', () => {
        expect([...gridPlaneBounds(new Float32Array())]).toEqual([0, 0, 5000, 5000]);
        expect([...gridPlaneBounds(Float32Array.of(NaN, 2, 0, 1, 1, -Infinity, 0, 1))])
            .toEqual([0, 0, 5000, 5000]);
    });
});
