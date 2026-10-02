import type { CameraState } from './renderer.js';

export interface ProjectedPoint {
    x: number;
    y: number;
    factor: number;
}

export interface Projection {
    camera: CameraState;
    halfWidth: number;
    halfHeight: number;
    cosYaw: number;
    sinYaw: number;
    cosPitch: number;
    sinPitch: number;
}

export function createProjection(camera: CameraState, width: number, height: number): Projection {
    return {
        camera,
        halfWidth: width / 2,
        halfHeight: height / 2,
        cosYaw: Math.cos(camera.yaw),
        sinYaw: Math.sin(camera.yaw),
        cosPitch: Math.cos(camera.pitch),
        sinPitch: Math.sin(camera.pitch),
    };
}

export function projectPoint(projection: Projection, x: number, y: number, z: number, out: ProjectedPoint): void {
    const { camera, halfWidth, halfHeight, cosYaw, sinYaw, cosPitch, sinPitch } = projection;
    const dx = x - camera.centerX;
    const dy = y - camera.centerY;
    if (!camera.mode3d) {
        out.x = halfWidth + dx * camera.scale;
        out.y = halfHeight + dy * camera.scale;
        out.factor = 1;
        return;
    }
    const dz = z - (camera.centerZ ?? 0);
    const rotatedX = cosYaw * dx - sinYaw * dz;
    const rotatedZ = sinYaw * dx + cosYaw * dz;
    const rotatedY = cosPitch * dy - sinPitch * rotatedZ;
    const viewZ = sinPitch * dy + cosPitch * rotatedZ;
    const distance = Math.max(camera.distance - viewZ, camera.referenceDistance * 0.05);
    const factor = camera.referenceDistance / distance;
    out.x = halfWidth + rotatedX * camera.scale * factor;
    out.y = halfHeight + rotatedY * camera.scale * factor;
    out.factor = factor;
}

/** Intersect the camera ray with the node's fixed-depth plane for dragging. */
export function unprojectAtDepth(projection: Projection, screenX: number, screenY: number, depth: number): { x: number; y: number } | null {
    const { camera, halfWidth, halfHeight, cosYaw, sinYaw, cosPitch, sinPitch } = projection;
    if (!camera.mode3d) return {
        x: camera.centerX + (screenX - halfWidth) / camera.scale,
        y: camera.centerY + (screenY - halfHeight) / camera.scale,
    };
    const u = (screenX - halfWidth) / (camera.scale * camera.referenceDistance);
    const v = (screenY - halfHeight) / (camera.scale * camera.referenceDistance);
    const eyeX = camera.centerX + cosPitch * sinYaw * camera.distance;
    const eyeY = camera.centerY + sinPitch * camera.distance;
    const eyeZ = (camera.centerZ ?? 0) + cosPitch * cosYaw * camera.distance;
    const rayX = cosYaw * u - sinPitch * sinYaw * v - cosPitch * sinYaw;
    const rayY = cosPitch * v - sinPitch;
    const rayZ = -sinYaw * u - sinPitch * cosYaw * v - cosPitch * cosYaw;
    if (Math.abs(rayZ) < 0.00001) return null;
    const along = (depth - eyeZ) / rayZ;
    if (along <= 0) return null;
    return { x: eyeX + rayX * along, y: eyeY + rayY * along };
}

/** Deterministic depth makes every 2D graph inspectable from a 3D camera. */
export function createDepths(nodes: Float32Array): Float32Array {
    const count = nodes.length / 4;
    const depths = new Float32Array(count);
    if (!count) return depths;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < nodes.length; i += 4) {
        minX = Math.min(minX, nodes[i]!);
        maxX = Math.max(maxX, nodes[i]!);
        minY = Math.min(minY, nodes[i + 1]!);
        maxY = Math.max(maxY, nodes[i + 1]!);
    }
    const span = Math.max(maxX - minX, maxY - minY, 100);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    for (let i = 0; i < count; i++) {
        const offset = i * 4;
        const x = (nodes[offset]! - centerX) / span;
        const y = (nodes[offset + 1]! - centerY) / span;
        const cluster = nodes[offset + 2]!;
        let hash = i * 1664525 + 1013904223;
        hash ^= hash >>> 16;
        const jitter = (hash >>> 0) / 4294967296 - 0.5;
        depths[i] = span * (Math.sin(x * 4.8) * Math.cos(y * 4.1) * 0.18
            + Math.sin(cluster * 2.39996) * 0.08 + jitter * 0.055);
    }
    return depths;
}
