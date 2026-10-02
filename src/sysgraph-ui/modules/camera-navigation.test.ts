import { describe, expect, it } from 'vitest';
import { cameraCenterAt } from './camera-navigation.js';

describe('camera navigation', () => {
    it('starts and ends at the requested centers and eases in and out', () => {
        const transition = { fromX: -80, fromY: 20, toX: 320, toY: -180, startedAt: 100, durationMs: 600 };
        expect(cameraCenterAt(transition, 100)).toEqual({ x: -80, y: 20, done: false });
        const quarter = cameraCenterAt(transition, 250);
        expect(quarter.x).toBeCloseTo(-17.5);
        expect(quarter.y).toBeCloseTo(-11.25);
        expect(quarter.done).toBe(false);
        expect(cameraCenterAt(transition, 700)).toEqual({ x: 320, y: -180, done: true });
    });
    it('eases 3D depth along with the camera center', () => {
        const transition = { fromX: 0, fromY: 0, fromZ: -100, toX: 100, toY: 200, toZ: 300,
            startedAt: 0, durationMs: 400 };
        expect(cameraCenterAt(transition, 200)).toEqual({ x: 50, y: 100, z: 100, done: false });
        expect(cameraCenterAt(transition, 400)).toEqual({ x: 100, y: 200, z: 300, done: true });
    });
});
