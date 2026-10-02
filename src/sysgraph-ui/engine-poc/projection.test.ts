import { describe, expect, it } from 'vitest';
import { createProjection, projectPoint, unprojectAtDepth } from './projection.js';
import type { CameraState } from './renderer.js';

const camera: CameraState = {
    centerX: 0, centerY: 0, scale: 2, stroke: 1,
    mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
};

function screen(cameraState: CameraState, x: number, y: number, z: number) {
    const projected = { x: 0, y: 0, factor: 1 };
    projectPoint(createProjection(cameraState, 800, 600), x, y, z, projected);
    return projected;
}

describe('3D perspective camera', () => {
    it('makes near points larger and strengthens perspective when dollying closer', () => {
        const near = screen(camera, 100, 0, 200);
        const far = screen(camera, 100, 0, -200);
        expect(near.factor).toBeGreaterThan(far.factor);
        expect(near.x - 400).toBeGreaterThan(far.x - 400);

        const closer = { ...camera, distance: 500 };
        const closeNear = screen(closer, 100, 0, 200);
        const closeFar = screen(closer, 100, 0, -200);
        expect(closeNear.factor / closeFar.factor).toBeGreaterThan(near.factor / far.factor);

        const flatNear = screen({ ...camera, mode3d: false }, 100, 0, 200);
        const flatFar = screen({ ...camera, mode3d: false }, 100, 0, -200);
        expect(flatNear).toEqual(flatFar);
    });

    it('unprojects a screen point to its world depth for accurate dragging', () => {
        const tilted = { ...camera, yaw: 0.45, pitch: 0.3 };
        const projection = createProjection(tilted, 800, 600);
        const projected = { x: 0, y: 0, factor: 1 };
        projectPoint(projection, 120, -40, 80, projected);
        const world = unprojectAtDepth(projection, projected.x, projected.y, 80);
        expect(world?.x).toBeCloseTo(120);
        expect(world?.y).toBeCloseTo(-40);
    });
});
