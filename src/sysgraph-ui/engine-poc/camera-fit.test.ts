import { describe, expect, it } from 'vitest';
import { fitCameraToPositions } from './camera-fit.js';
import { createProjection, projectPoint, unprojectAtDepth } from './projection.js';
import type { CameraState } from './renderer.js';

function camera(mode3d: boolean, yaw = 0.48): CameraState {
    return {
        centerX: -500, centerY: 200, centerZ: 0, scale: 0.25, stroke: 1,
        mode3d, yaw, pitch: 0.3, distance: 1000, referenceDistance: 1000,
    };
}

function projectedBounds(view: CameraState, positions: Float32Array) {
    const projection = createProjection(view, 1600, 900);
    const point = { x: 0, y: 0, factor: 1 };
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let i = 0; i < positions.length; i += 4) {
        projectPoint(projection, positions[i]!, positions[i + 1]!, positions[i + 2]!, point);
        left = Math.min(left, point.x); right = Math.max(right, point.x);
        top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
    }
    return { left, right, top, bottom };
}

describe('camera fit', () => {
    const dnaLike = Float32Array.of(
        100, 20, 1150, 5,
        140, 70, 1200, 5,
        180, 180, 1280, 5,
        260, 420, 1430, 5,
        290, 500, 1470, 5,
        90, 510, 1390, 5,
    );

    it.each([0.48, Math.PI / 2])('centers depth-offset graph in perspective at yaw %f', yaw => {
        const view = camera(true, yaw);
        expect(fitCameraToPositions(view, dnaLike, 1600, 900)).toBe(true);
        const box = projectedBounds(view, dnaLike);
        expect((box.left + box.right) / 2).toBeCloseTo(800, 0);
        expect((box.top + box.bottom) / 2).toBeCloseTo(450, 0);
        expect(box.left).toBeGreaterThan(0);
        expect(box.right).toBeLessThan(1600);
        expect(box.top).toBeGreaterThan(0);
        expect(box.bottom).toBeLessThan(900);
        expect(view.centerZ).toBeGreaterThan(1000);
    });

    it('keeps 2D framing independent of depth and resets the depth pivot', () => {
        const view = camera(false);
        expect(fitCameraToPositions(view, dnaLike, 1600, 900)).toBe(true);
        expect(view.centerX).toBe(190);
        expect(view.centerY).toBe(265);
        expect(view.centerZ).toBe(0);
        const box = projectedBounds(view, dnaLike);
        expect((box.left + box.right) / 2).toBeCloseTo(800);
        expect((box.top + box.bottom) / 2).toBeCloseTo(450);
    });

    it('uses the depth pivot for accurate ray dragging', () => {
        const view = camera(true);
        fitCameraToPositions(view, dnaLike, 1600, 900);
        const projection = createProjection(view, 1600, 900);
        const point = { x: 0, y: 0, factor: 1 };
        projectPoint(projection, 180, 180, 1280, point);
        const world = unprojectAtDepth(projection, point.x, point.y, 1280);
        expect(world?.x).toBeCloseTo(180);
        expect(world?.y).toBeCloseTo(180);
    });
});
