import { describe, expect, it } from 'vitest';
import { createProjection, perspectiveNearPlane, projectPoint, projectSegment, unprojectAtDepth } from './projection.js';
import type { CameraState } from './renderer.js';

const camera: CameraState = {
    centerX: 0, centerY: 0, scale: 2, stroke: 1,
    mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
};

function screen(cameraState: CameraState, x: number, y: number, z: number) {
    const projected = { x: 0, y: 0, factor: 1, visible: true };
    projectPoint(createProjection(cameraState, 800, 600), x, y, z, projected);
    return projected;
}

describe('3D perspective camera', () => {
    it('shrinks the near plane for close inspection while preserving fitted clipping', () => {
        expect(perspectiveNearPlane(camera)).toBe(50);
        const close = { ...camera, distance: 10 };
        expect(perspectiveNearPlane(close)).toBe(1);
        expect(screen(close, 0, 0, 8.5).visible).toBe(true);
        expect(screen(close, 0, 0, 9.5).visible).toBe(false);

        const segment = { a: { x: 0, y: 0, factor: 1, visible: true },
            b: { x: 0, y: 0, factor: 1, visible: true } };
        expect(projectSegment(createProjection(close, 800, 600), -1, 0, 9.5, 1, 0, 8, segment)).toBe(true);
        expect(segment.a.factor).toBeCloseTo(1000);
        expect(segment.b.factor).toBeCloseTo(500);
    });

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

    it('clips either link endpoint at the near plane before projecting it', () => {
        const projection = createProjection(camera, 800, 600);
        const segment = { a: { x: 0, y: 0, factor: 1, visible: true },
            b: { x: 0, y: 0, factor: 1, visible: true } };

        expect(projectSegment(projection, -10, 0, 980, 10, 0, 900, segment)).toBe(true);
        expect(segment.a.x).toBeCloseTo(300);
        expect(segment.a.y).toBeCloseTo(300);
        expect(segment.a.factor).toBeCloseTo(20);
        expect(segment.b.x).toBeCloseTo(600);
        expect(segment.a.visible).toBe(true);

        expect(projectSegment(projection, 10, 0, 900, -10, 0, 980, segment)).toBe(true);
        expect(segment.a.x).toBeCloseTo(600);
        expect(segment.b.x).toBeCloseTo(300);
        expect(segment.b.visible).toBe(true);
        expect(projectSegment(projection, -10, 0, 980, 10, 0, 990, segment)).toBe(false);
    });

    it('clips in camera space after rotation', () => {
        const projection = createProjection({ ...camera, yaw: 0.45, pitch: 0.3 }, 800, 600);
        const world = (side: number, distance: number) => {
            const viewZ = camera.distance - distance;
            return {
                x: projection.right[0] * side + projection.toward[0] * viewZ,
                y: projection.right[1] * side + projection.toward[1] * viewZ,
                z: projection.right[2] * side + projection.toward[2] * viewZ,
            };
        };
        const a = world(-10, 20), b = world(10, 100);
        const segment = { a: { x: 0, y: 0, factor: 1 }, b: { x: 0, y: 0, factor: 1 } };

        expect(projectSegment(projection, a.x, a.y, a.z, b.x, b.y, b.z, segment)).toBe(true);
        expect(segment.a.x).toBeCloseTo(300);
        expect(segment.a.y).toBeCloseTo(300);
        expect(segment.b.x).toBeCloseTo(600);
    });
});

describe('3D orthographic camera', () => {
    it('keeps projected size independent of depth and camera distance', () => {
        const orthographic = { ...camera, projection: 'orthographic' as const };
        const near = screen(orthographic, 100, 0, 200);
        const far = screen(orthographic, 100, 0, -200);
        expect(near).toEqual(far);
        expect(screen({ ...orthographic, distance: 500 }, 100, 0, 200)).toEqual(near);
    });

    it('unprojects through an orbit into the node depth plane', () => {
        const orthographic = { ...camera, projection: 'orthographic' as const,
            yaw: Math.PI / 4, pitch: Math.atan(1 / Math.sqrt(2)) };
        const projection = createProjection(orthographic, 800, 600);
        const point = { x: 0, y: 0, factor: 1 };
        projectPoint(projection, 120, -40, 80, point);
        const world = unprojectAtDepth(projection, point.x, point.y, 80);
        expect(world?.x).toBeCloseTo(120);
        expect(world?.y).toBeCloseTo(-40);
    });

    it('does not clip segments by perspective distance', () => {
        const projection = createProjection({ ...camera, projection: 'orthographic' }, 800, 600);
        const segment = { a: { x: 0, y: 0, factor: 1 }, b: { x: 0, y: 0, factor: 1 } };

        expect(projectSegment(projection, -10, 0, 980, 10, 0, 990, segment)).toBe(true);
        expect(segment.a.x).toBeCloseTo(380);
        expect(segment.b.x).toBeCloseTo(420);
        expect(segment.a.factor).toBe(1);
    });
});
