import { describe, expect, it } from 'vitest';
import { cameraBasis, orbitPitchAroundViewRight, orbitYawAroundViewUp, orientationFromYawPitch } from '../engine/camera-orientation.js';
import type { CameraState } from '../engine/renderer.js';
import { CameraFlight, isFlightKey } from './camera-flight.js';

const camera = {
    yaw: 0, pitch: 0, centerX: 0, centerY: 0, centerZ: 0, distance: 1000,
    referenceDistance: 1000, scale: 1, stroke: 1, mode3d: true,
    projection: 'perspective',
} as CameraState;

function travel(flight: CameraFlight, view: CameraState, seconds: number): number[] {
    const position = [0, 0, 0];
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.01) {
        const { move } = flight.step(view, 0.01, 800);
        for (let axis = 0; axis < 3; axis++) position[axis] += move[axis]!;
    }
    return position;
}

describe('3D arrow flight', () => {
    it('moves forward and sideways in the current camera orientation', () => {
        const flight = new CameraFlight();
        flight.press('ArrowUp');
        let moved = travel(flight, camera, 0.5);
        expect(moved[2]).toBeLessThan(-200);
        expect(moved[0]).toBeCloseTo(0);

        const turned = { ...camera, orientation: orientationFromYawPitch(Math.PI / 2, 0) };
        flight.clear();
        flight.press('ArrowRight');
        moved = travel(flight, turned, 0.5);
        const { right } = cameraBasis(turned.orientation);
        expect(moved[0]! * right[0] + moved[1]! * right[1] + moved[2]! * right[2]).toBeGreaterThan(200);

        flight.clear();
        flight.press('ArrowUp');
        moved = travel(flight, { ...camera, orientation: orientationFromYawPitch(0, Math.PI / 4) }, 0.5);
        expect(Math.abs(moved[1]!)).toBeGreaterThan(100);
        expect(Math.abs(moved[2]!)).toBeGreaterThan(100);
    });

    it('accelerates, brakes after release, and avoids a long jump after a paused frame', () => {
        const flight = new CameraFlight();
        flight.press('ArrowUp');
        const first = flight.step(camera, 0.01, 800).move;
        const later = travel(flight, camera, 0.3);
        expect(-later[2]!).toBeGreaterThan(-first[2]! * 20);
        const paused = flight.step(camera, 10, 800).move;
        expect(Math.abs(paused[2]!)).toBeLessThan(40);
        flight.release('ArrowUp');
        const coast = travel(flight, camera, 0.6);
        expect(-coast[2]!).toBeGreaterThan(0);
        expect(-coast[2]!).toBeLessThan(100);
        expect(Math.abs(flight.step(camera, 0.01, 800).move[2]!)).toBeLessThan(0.01);
        flight.clear();
        expect(flight.step(camera, 0.01, 800)).toEqual({ move: [0, 0, 0], yaw: 0, pitch: 0 });
    });

    it('normalizes diagonal movement and recognizes only arrow keys', () => {
        const straight = new CameraFlight();
        straight.press('ArrowUp');
        const diagonal = new CameraFlight();
        diagonal.press('ArrowUp'); diagonal.press('ArrowRight');
        expect(Math.hypot(...travel(diagonal, camera, 0.5))).toBeCloseTo(
            Math.hypot(...travel(straight, camera, 0.5)), 5);
        expect(isFlightKey('ArrowLeft')).toBe(true);
        expect(isFlightKey('w')).toBe(false);
    });

    it('switches held left and right arrows from strafe to orbit without moving the pivot', () => {
        const flight = new CameraFlight();
        flight.press('ArrowRight');
        expect(flight.step(camera, 0.05, 800).move[0]).toBeGreaterThan(0);

        flight.setOrbitModifier(true);
        const orbit = flight.step(camera, 0.05, 800);
        expect(orbit.move).toEqual([0, 0, 0]);
        expect(orbit.yaw).toBeGreaterThan(0);
        const turned = orbitYawAroundViewUp(orientationFromYawPitch(0, 0), orbit.yaw);
        expect(cameraBasis(turned).toward[0]).toBeGreaterThan(0);

        flight.setOrbitModifier(false);
        const strafe = flight.step(camera, 0.05, 800);
        expect(strafe.yaw).toBe(0);
        expect(strafe.move[0]).toBeGreaterThan(0);
        flight.release('ArrowRight');
    });

    it('switches held up and down arrows from flight to vertical orbit', () => {
        const flight = new CameraFlight();
        flight.press('ArrowUp');
        expect(flight.step(camera, 0.05, 800).move[2]).toBeLessThan(0);

        flight.setOrbitModifier(true);
        const orbitUp = flight.step(camera, 0.05, 800);
        expect(orbitUp.move).toEqual([0, 0, 0]);
        expect(orbitUp.yaw).toBe(0);
        expect(orbitUp.pitch).toBeGreaterThan(0);
        const turned = orbitPitchAroundViewRight(orientationFromYawPitch(0, 0), orbitUp.pitch);
        expect(cameraBasis(turned).toward[1]).toBeLessThan(0);

        flight.clear();
        flight.setOrbitModifier(true);
        flight.press('ArrowDown');
        const orbitDown = flight.step(camera, 0.05, 800);
        expect(orbitDown.move).toEqual([0, 0, 0]);
        expect(orbitDown.pitch).toBeLessThan(0);

        flight.setOrbitModifier(false);
        const backward = flight.step(camera, 0.05, 800);
        expect(backward.pitch).toBe(0);
        expect(backward.move[2]).toBeGreaterThan(0);
    });

    it('keeps diagonal Shift orbiting at the same angular speed', () => {
        const single = new CameraFlight();
        single.setOrbitModifier(true);
        single.press('ArrowUp');
        const diagonal = new CameraFlight();
        diagonal.setOrbitModifier(true);
        diagonal.press('ArrowUp');
        diagonal.press('ArrowRight');
        let pitch = 0;
        let yaw = 0;
        let diagonalPitch = 0;
        for (let frame = 0; frame < 50; frame++) {
            const straight = single.step(camera, 0.01, 800);
            const angled = diagonal.step(camera, 0.01, 800);
            pitch += straight.pitch;
            yaw += angled.yaw;
            diagonalPitch += angled.pitch;
            expect(angled.move).toEqual([0, 0, 0]);
        }
        expect(Math.hypot(yaw, diagonalPitch)).toBeCloseTo(pitch, 6);
    });
});
