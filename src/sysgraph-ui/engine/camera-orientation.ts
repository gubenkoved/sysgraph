/** A world-to-camera rotation in [x, y, z, w] order. */
export type Quaternion = readonly [number, number, number, number];
export type Vector3 = readonly [number, number, number];

export function orientationFromYawPitch(yaw: number, pitch: number): Quaternion {
    const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2);
    const sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
    // First yaw around world Y, then pitch around the camera's X axis.
    return [sp * cy, -cp * sy, -sp * sy, cp * cy];
}

export function orientationForCamera(camera: { yaw: number; pitch: number; orientation?: Quaternion }): Quaternion {
    return camera.orientation ?? orientationFromYawPitch(camera.yaw, camera.pitch);
}

function multiply(a: Quaternion, b: Quaternion): Quaternion {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

function normalize(q: Quaternion): Quaternion {
    const length = Math.hypot(...q);
    return length > 0 ? [q[0] / length, q[1] / length, q[2] / length, q[3] / length] : [0, 0, 0, 1];
}

/** Orbit around the view's fixed center using its current screen-up axis. */
export function orbitYawAroundViewUp(orientation: Quaternion, radians: number): Quaternion {
    if (!radians) return orientation;
    const half = radians / 2;
    // Camera-space yaw must be applied before the existing world-to-camera
    // rotation. Applying it afterward uses world Y, which reverses left and
    // right when the view has rolled upside down.
    return normalize(multiply([0, -Math.sin(half), 0, Math.cos(half)], orientation));
}

/** Orbit toward screen up around the view's fixed center. */
export function orbitPitchAroundViewRight(orientation: Quaternion, radians: number): Quaternion {
    if (!radians) return orientation;
    const half = radians / 2;
    return normalize(multiply([-Math.sin(half), 0, 0, Math.cos(half)], orientation));
}

export function rotateVector(q: Quaternion, vector: Vector3): Vector3 {
    const [x, y, z, w] = q;
    const [vx, vy, vz] = vector;
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [
        vx + w * tx + y * tz - z * ty,
        vy + w * ty + z * tx - x * tz,
        vz + w * tz + x * ty - y * tx,
    ];
}

export function cameraBasis(orientation: Quaternion): { right: Vector3; down: Vector3; toward: Vector3 } {
    const inverse: Quaternion = [-orientation[0], -orientation[1], -orientation[2], orientation[3]];
    return {
        right: rotateVector(inverse, [1, 0, 0]),
        down: rotateVector(inverse, [0, 1, 0]),
        toward: rotateVector(inverse, [0, 0, 1]),
    };
}

function arcballPoint(x: number, y: number, width: number, height: number): Vector3 {
    const radius = Math.max(1, Math.min(width, height) / 3);
    const px = (x - width / 2) / radius;
    const py = (y - height / 2) / radius;
    const squared = px * px + py * py;
    const z = squared <= 0.5 ? Math.sqrt(1 - squared) : 0.5 / Math.sqrt(squared);
    const length = Math.hypot(px, py, z);
    return [px / length, py / length, z / length];
}

/** Rotate the camera as if dragging the visible surface of a trackball. */
export function orbitTrackball(orientation: Quaternion, fromX: number, fromY: number,
    toX: number, toY: number, width: number, height: number): Quaternion {
    const from = arcballPoint(fromX, fromY, width, height);
    const to = arcballPoint(toX, toY, width, height);
    // Inverse of the sphere's motion: moving right or down keeps the existing
    // camera-orbit drag direction while allowing movement through the poles.
    const cross: Vector3 = [
        to[1] * from[2] - to[2] * from[1],
        to[2] * from[0] - to[0] * from[2],
        to[0] * from[1] - to[1] * from[0],
    ];
    const dot = to[0] * from[0] + to[1] * from[1] + to[2] * from[2];
    if (dot > 1 - 1e-12) return orientation;
    const drag = dot < -1 + 1e-6
        ? normalize([from[1], -from[0], 0, 0])
        : normalize([cross[0], cross[1], cross[2], 1 + dot]);
    return normalize(multiply(drag, orientation));
}
