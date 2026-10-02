import { cameraBasis, orientationForCamera, type Vector3 } from './camera-orientation.js';
import type { CameraState } from './renderer.js';

export interface ProjectedPoint {
    x: number;
    y: number;
    factor: number;
    visible?: boolean;
}

export interface ProjectedSegment {
    a: ProjectedPoint;
    b: ProjectedPoint;
}

export interface Projection {
    camera: CameraState;
    halfWidth: number;
    halfHeight: number;
    right: Vector3;
    down: Vector3;
    toward: Vector3;
}

export function createProjection(camera: CameraState, width: number, height: number): Projection {
    const basis = cameraBasis(orientationForCamera(camera));
    return {
        camera,
        halfWidth: width / 2,
        halfHeight: height / 2,
        ...basis,
    };
}

/** Keep the fitted view's clipping distance while allowing close dolly views. */
export function perspectiveNearPlane(camera: Pick<CameraState, 'distance' | 'referenceDistance'>): number {
    return Math.max(1e-6, Math.min(camera.referenceDistance * 0.05, camera.distance * 0.1));
}

export function projectPoint(projection: Projection, x: number, y: number, z: number, out: ProjectedPoint): void {
    const { camera, halfWidth, halfHeight, right, down, toward } = projection;
    const dx = x - camera.centerX;
    const dy = y - camera.centerY;
    if (!camera.mode3d) {
        out.x = halfWidth + dx * camera.scale;
        out.y = halfHeight + dy * camera.scale;
        out.factor = 1;
        out.visible = true;
        return;
    }
    const dz = z - (camera.centerZ ?? 0);
    const rotatedX = right[0] * dx + right[1] * dy + right[2] * dz;
    const rotatedY = down[0] * dx + down[1] * dy + down[2] * dz;
    const viewZ = toward[0] * dx + toward[1] * dy + toward[2] * dz;
    const rawDistance = camera.distance - viewZ;
    const near = perspectiveNearPlane(camera);
    const distance = Math.max(rawDistance, near);
    const factor = camera.projection === 'orthographic' ? 1 : camera.referenceDistance / distance;
    out.x = halfWidth + rotatedX * camera.scale * factor;
    out.y = halfHeight + rotatedY * camera.scale * factor;
    out.factor = factor;
    out.visible = camera.projection === 'orthographic' || rawDistance >= near;
}

/** Clip a link at the perspective near plane before projecting its visible segment. */
export function projectSegment(projection: Projection, ax: number, ay: number, az: number,
    bx: number, by: number, bz: number, out: ProjectedSegment): boolean {
    const { camera, toward } = projection;
    if (camera.mode3d && camera.projection !== 'orthographic') {
        const near = perspectiveNearPlane(camera);
        const aDistance = camera.distance - (toward[0] * (ax - camera.centerX) +
            toward[1] * (ay - camera.centerY) + toward[2] * (az - (camera.centerZ ?? 0)));
        const bDistance = camera.distance - (toward[0] * (bx - camera.centerX) +
            toward[1] * (by - camera.centerY) + toward[2] * (bz - (camera.centerZ ?? 0)));
        if (aDistance < near && bDistance < near) return false;
        if (aDistance < near) {
            const t = (near - aDistance) / (bDistance - aDistance);
            ax += (bx - ax) * t;
            ay += (by - ay) * t;
            az += (bz - az) * t;
        } else if (bDistance < near) {
            const t = (aDistance - near) / (aDistance - bDistance);
            bx = ax + (bx - ax) * t;
            by = ay + (by - ay) * t;
            bz = az + (bz - az) * t;
        }
    }
    projectPoint(projection, ax, ay, az, out.a);
    projectPoint(projection, bx, by, bz, out.b);
    return true;
}

/** Intersect the camera ray with the node's fixed-depth plane for dragging. */
export function unprojectAtDepth(projection: Projection, screenX: number, screenY: number, depth: number): { x: number; y: number } | null {
    const { camera, halfWidth, halfHeight, right, down, toward } = projection;
    if (!camera.mode3d) return {
        x: camera.centerX + (screenX - halfWidth) / camera.scale,
        y: camera.centerY + (screenY - halfHeight) / camera.scale,
    };
    if (camera.projection === 'orthographic') {
        const screenU = (screenX - halfWidth) / camera.scale;
        const screenV = (screenY - halfHeight) / camera.scale;
        const offsetX = right[0] * screenU + down[0] * screenV;
        const offsetY = right[1] * screenU + down[1] * screenV;
        const offsetZ = right[2] * screenU + down[2] * screenV;
        const rayZ = -toward[2];
        if (Math.abs(rayZ) < 0.00001) return null;
        const along = (depth - (camera.centerZ ?? 0) - offsetZ) / rayZ;
        return {
            x: camera.centerX + offsetX - toward[0] * along,
            y: camera.centerY + offsetY - toward[1] * along,
        };
    }
    const u = (screenX - halfWidth) / (camera.scale * camera.referenceDistance);
    const v = (screenY - halfHeight) / (camera.scale * camera.referenceDistance);
    const eyeX = camera.centerX + toward[0] * camera.distance;
    const eyeY = camera.centerY + toward[1] * camera.distance;
    const eyeZ = (camera.centerZ ?? 0) + toward[2] * camera.distance;
    const rayX = right[0] * u + down[0] * v - toward[0];
    const rayY = right[1] * u + down[1] * v - toward[1];
    const rayZ = right[2] * u + down[2] * v - toward[2];
    if (Math.abs(rayZ) < 0.00001) return null;
    const along = (depth - eyeZ) / rayZ;
    if (along <= 0) return null;
    return { x: eyeX + rayX * along, y: eyeY + rayY * along };
}

/** The screen ray's point in the camera-facing plane through a world point. */
export function unprojectOnCameraPlane(projection: Projection, screenX: number, screenY: number,
    planePoint: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const { camera, right, down } = projection;
    if (!camera.mode3d) return {
        x: camera.centerX + (screenX - projection.halfWidth) / camera.scale,
        y: camera.centerY + (screenY - projection.halfHeight) / camera.scale,
        z: planePoint.z,
    };
    const projected = { x: 0, y: 0, factor: 1 };
    projectPoint(projection, planePoint.x, planePoint.y, planePoint.z, projected);
    const u = (screenX - projected.x) / (camera.scale * projected.factor);
    const v = (screenY - projected.y) / (camera.scale * projected.factor);
    return {
        x: planePoint.x + right[0] * u + down[0] * v,
        y: planePoint.y + right[1] * u + down[1] * v,
        z: planePoint.z + right[2] * u + down[2] * v,
    };
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
