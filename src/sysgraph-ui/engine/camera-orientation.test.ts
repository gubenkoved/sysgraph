import { describe, expect, it } from 'vitest';
import { cameraBasis, orbitPitchAroundViewRight, orbitTrackball, orbitYawAroundViewUp, orientationFromYawPitch } from './camera-orientation.js';
import { createProjection, projectPoint, unprojectOnCameraPlane } from './projection.js';
import type { CameraState } from './renderer.js';

const WIDTH = 800;
const HEIGHT = 600;

function camera(orientation: ReturnType<typeof orientationFromYawPitch>,
    projection: 'perspective' | 'orthographic' = 'perspective'): CameraState {
    return {
        centerX: 32, centerY: -46, centerZ: 118,
        scale: 2, stroke: 1, mode3d: true,
        yaw: 0, pitch: 0, orientation,
        distance: 1000, referenceDistance: 1000, projection,
    };
}

function dot(left: readonly number[], right: readonly number[]): number {
    return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function expectUnitOrientation(orientation: ReturnType<typeof orientationFromYawPitch>): void {
    expect(orientation.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...orientation)).toBeCloseTo(1, 8);
    const { right, down, toward } = cameraBasis(orientation);
    for (const axis of [right, down, toward]) expect(dot(axis, axis)).toBeCloseTo(1, 8);
    expect(dot(right, down)).toBeCloseTo(0, 8);
    expect(dot(right, toward)).toBeCloseTo(0, 8);
    expect(dot(down, toward)).toBeCloseTo(0, 8);
}

describe('free 3D camera orientation', () => {
    it('orbits toward screen right even when the view is inverted or rolled', () => {
        const rolled = orbitTrackball(
            orbitTrackball(orientationFromYawPitch(0.35, 0.2), 400, 300, 400, 120, WIDTH, HEIGHT),
            400, 300, 570, 300, WIDTH, HEIGHT,
        );
        for (const initial of [
            orientationFromYawPitch(0.4, 0.25),
            orientationFromYawPitch(0, Math.PI),
            rolled,
        ]) {
            const before = cameraBasis(initial);
            const rightTurn = orbitYawAroundViewUp(initial, 0.5);
            const leftTurn = orbitYawAroundViewUp(initial, -0.5);
            const rightMotion = cameraBasis(rightTurn).toward.map((value, axis) => value - before.toward[axis]!);
            expect(dot(rightMotion, before.right)).toBeCloseTo(Math.sin(0.5), 8);
            const leftMotion = cameraBasis(leftTurn).toward.map((value, axis) => value - before.toward[axis]!);
            expect(dot(leftMotion, before.right)).toBeCloseTo(-Math.sin(0.5), 8);
            expectUnitOrientation(rightTurn);

            const upTurn = orbitPitchAroundViewRight(initial, 0.5);
            const downTurn = orbitPitchAroundViewRight(initial, -0.5);
            const upMotion = cameraBasis(upTurn).toward.map((value, axis) => value - before.toward[axis]!);
            const downMotion = cameraBasis(downTurn).toward.map((value, axis) => value - before.toward[axis]!);
            expect(dot(upMotion, before.down)).toBeCloseTo(-Math.sin(0.5), 8);
            expect(dot(downMotion, before.down)).toBeCloseTo(Math.sin(0.5), 8);
            expectUnitOrientation(upTurn);
        }
    });
    it('preserves the existing yaw and pitch camera axes at initialization', () => {
        const yaw = 0.48;
        const pitch = 0.3;
        const orientation = orientationFromYawPitch(yaw, pitch);
        const { right, down, toward } = cameraBasis(orientation);
        const expected = [
            [Math.cos(yaw), 0, -Math.sin(yaw)],
            [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)],
            [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)],
        ];
        for (const [index, axis] of [right, down, toward].entries()) {
            for (let component = 0; component < 3; component++) {
                expect(axis[component]).toBeCloseTo(expected[index]![component]!, 8);
            }
        }
        expectUnitOrientation(orientation);
    });

    it('keeps rotating past the former pitch limit and across a pole', () => {
        let orientation = orientationFromYawPitch(0, 0);
        const projectedWorldUp: number[] = [];
        for (let turn = 0; turn < 8; turn++) {
            const previous = orientation;
            orientation = orbitTrackball(orientation, 400, 300, 400, 40, WIDTH, HEIGHT);
            expect(orientation).not.toEqual(previous);
            expectUnitOrientation(orientation);
            projectedWorldUp.push(cameraBasis(orientation).down[1]);
        }
        expect(Math.min(...projectedWorldUp)).toBeLessThan(-0.1);
        expect(projectedWorldUp[projectedWorldUp.length - 1]).not.toBeCloseTo(projectedWorldUp[0]!, 4);
    });

    it('can produce roll through successive drags and stays normalized', () => {
        const initial = orientationFromYawPitch(0, 0);
        const initialCopy = [...initial];
        let orientation = orbitTrackball(initial, 400, 300, 400, 140, WIDTH, HEIGHT);
        orientation = orbitTrackball(orientation, 400, 300, 560, 300, WIDTH, HEIGHT);
        expect(initial).toEqual(initialCopy);
        expect(Math.abs(cameraBasis(orientation).right[1])).toBeGreaterThan(0.02);

        for (let turn = 0; turn < 256; turn++) {
            const fromX = 200 + (turn % 5) * 60;
            orientation = orbitTrackball(orientation, fromX, 260, fromX + 45, 320, WIDTH, HEIGHT);
        }
        expectUnitOrientation(orientation);
    });
});

describe('projection after free orbit', () => {
    const sideView = orientationFromYawPitch(Math.PI / 2, 0);
    const rolled = orbitTrackball(
        orbitTrackball(orientationFromYawPitch(0.35, 0.2), 400, 300, 400, 120, WIDTH, HEIGHT),
        400, 300, 570, 300, WIDTH, HEIGHT,
    );
    const orientations = [orientationFromYawPitch(0, 0), sideView, rolled];

    it.each(['perspective', 'orthographic'] as const)(
        'round-trips a point through the camera-facing plane in %s', projectionMode => {
            for (const orientation of orientations) {
                const view = camera(orientation, projectionMode);
                const projection = createProjection(view, WIDTH, HEIGHT);
                const point = { x: 90, y: -15, z: 175 };
                const screen = { x: 0, y: 0, factor: 1 };
                projectPoint(projection, point.x, point.y, point.z, screen);
                const recovered = unprojectOnCameraPlane(projection, screen.x, screen.y, point);
                expect(recovered).not.toBeNull();
                expect(recovered!.x).toBeCloseTo(point.x, 6);
                expect(recovered!.y).toBeCloseTo(point.y, 6);
                expect(recovered!.z).toBeCloseTo(point.z, 6);
            }
        },
    );

    it.each(['perspective', 'orthographic'] as const)(
        'gives a stable off-center screen anchor in a side view in %s', projectionMode => {
            const view = camera(sideView, projectionMode);
            const projection = createProjection(view, WIDTH, HEIGHT);
            const pivot = { x: view.centerX, y: view.centerY, z: view.centerZ! };
            const world = unprojectOnCameraPlane(projection, 650, 180, pivot);
            expect(world).not.toBeNull();
            expect([world!.x, world!.y, world!.z].every(Number.isFinite)).toBe(true);
            const screen = { x: 0, y: 0, factor: 1 };
            projectPoint(projection, world!.x, world!.y, world!.z, screen);
            expect(screen.x).toBeCloseTo(650, 6);
            expect(screen.y).toBeCloseTo(180, 6);
        },
    );
});
