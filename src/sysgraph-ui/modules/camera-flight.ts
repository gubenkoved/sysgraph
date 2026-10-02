import { cameraBasis, orientationForCamera, type Vector3 } from '../engine/camera-orientation.js';
import type { CameraState } from '../engine/renderer.js';

export type FlightKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export function isFlightKey(key: string): key is FlightKey {
    return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

export interface FlightStep { move: Vector3; yaw: number; pitch: number }

/** Camera-relative translation with a short acceleration and braking tail. */
export class CameraFlight {
    private readonly keys = new Set<FlightKey>();
    private orbitModifier = false;
    private sidewaysVelocity = 0;
    private forwardVelocity = 0;
    private yawVelocity = 0;
    private pitchVelocity = 0;

    press(key: FlightKey): void { this.keys.add(key); }
    release(key: FlightKey): void { this.keys.delete(key); }
    setOrbitModifier(active: boolean): void {
        if (this.orbitModifier === active) return;
        this.orbitModifier = active;
        // Switching modes should not carry translation into an orbit, or keep
        // orbiting after Shift is released.
        this.sidewaysVelocity = 0;
        this.forwardVelocity = 0;
        this.yawVelocity = 0;
        this.pitchVelocity = 0;
    }
    clear(): void {
        this.keys.clear();
        this.orbitModifier = false;
        this.sidewaysVelocity = 0;
        this.forwardVelocity = 0;
        this.yawVelocity = 0;
        this.pitchVelocity = 0;
    }

    step(camera: CameraState, elapsedSeconds: number, viewportHeight: number): FlightStep {
        const dt = Math.min(0.05, Math.max(0, elapsedSeconds));
        if (dt === 0 || (!this.keys.size &&
            Math.hypot(this.sidewaysVelocity, this.forwardVelocity, this.yawVelocity, this.pitchVelocity) < 0.001)) {
            return { move: [0, 0, 0], yaw: 0, pitch: 0 };
        }

        const horizontal = Number(this.keys.has('ArrowRight')) - Number(this.keys.has('ArrowLeft'));
        const vertical = Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'));
        const sideways = this.orbitModifier ? 0 : horizontal;
        const forward = this.orbitModifier ? 0 : vertical;
        const inputLength = Math.hypot(sideways, forward);
        const visibleDepth = camera.projection === 'orthographic'
            ? viewportHeight / Math.max(0.00001, camera.scale)
            : camera.distance;
        const speed = Math.max(8, visibleDepth * 0.65);
        const blend = 1 - Math.exp(-dt / (inputLength > 0 ? 0.11 : 0.075));
        const oldSideways = this.sidewaysVelocity;
        const oldForward = this.forwardVelocity;
        this.sidewaysVelocity += ((inputLength ? sideways * speed / inputLength : 0) - oldSideways) * blend;
        this.forwardVelocity += ((inputLength ? forward * speed / inputLength : 0) - oldForward) * blend;
        const sideDistance = (oldSideways + this.sidewaysVelocity) * dt / 2;
        const forwardDistance = (oldForward + this.forwardVelocity) * dt / 2;
        const { right, toward } = cameraBasis(orientationForCamera(camera));
        const orbitLength = this.orbitModifier ? Math.hypot(horizontal, vertical) : 0;
        const orbitBlend = 1 - Math.exp(-dt / (orbitLength ? 0.11 : 0.075));
        const oldYaw = this.yawVelocity;
        const oldPitch = this.pitchVelocity;
        this.yawVelocity += ((orbitLength ? horizontal * 1.3 / orbitLength : 0) - oldYaw) * orbitBlend;
        this.pitchVelocity += ((orbitLength ? vertical * 1.3 / orbitLength : 0) - oldPitch) * orbitBlend;
        return {
            move: [
                right[0] * sideDistance - toward[0] * forwardDistance,
                right[1] * sideDistance - toward[1] * forwardDistance,
                right[2] * sideDistance - toward[2] * forwardDistance,
            ],
            yaw: (oldYaw + this.yawVelocity) * dt / 2,
            pitch: (oldPitch + this.pitchVelocity) * dt / 2,
        };
    }
}
