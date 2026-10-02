import { createProjection, projectPoint } from './projection.js';
import type { CameraState } from './renderer.js';

/** Frames the visible positions around the camera's orbit pivot. Positions use four floats per node. */
export function fitCameraToPositions(camera: CameraState, positions: Float32Array, width: number, height: number): boolean {
    if (width <= 1 || height <= 1 || positions.length < 4) return false;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 4) {
        const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) return false;

    camera.centerX = (minX + maxX) / 2;
    camera.centerY = (minY + maxY) / 2;
    camera.centerZ = camera.mode3d ? (minZ + maxZ) / 2 : 0;
    const span = Math.max(100, maxX - minX, maxY - minY, camera.mode3d ? maxZ - minZ : 0);
    camera.referenceDistance = span * 2.8;
    camera.distance = camera.referenceDistance;

    if (!camera.mode3d) {
        camera.scale = Math.max(0.00001, Math.min(6,
            width * 0.84 / Math.max(1, maxX - minX),
            height * 0.84 / Math.max(1, maxY - minY)));
        return true;
    }

    // Perspective and rotation change both the screen bounds and their midpoint.
    // Shift the pivot in the camera's image plane until the projected bounds are centered.
    camera.scale = 1;
    const cosYaw = Math.cos(camera.yaw), sinYaw = Math.sin(camera.yaw);
    const cosPitch = Math.cos(camera.pitch), sinPitch = Math.sin(camera.pitch);
    const projected = { x: 0, y: 0, factor: 1 };
    const bounds = () => {
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        const projection = createProjection(camera, width, height);
        for (let i = 0; i < positions.length; i += 4) {
            const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
            projectPoint(projection, x, y, z, projected);
            left = Math.min(left, projected.x); right = Math.max(right, projected.x);
            top = Math.min(top, projected.y); bottom = Math.max(bottom, projected.y);
        }
        return { left, top, right, bottom };
    };
    let box = bounds();
    for (let iteration = 0; iteration < 4; iteration++) {
        const offsetX = (box.left + box.right - width) / 2;
        const offsetY = (box.top + box.bottom - height) / 2;
        if (Math.abs(offsetX) + Math.abs(offsetY) < 0.001) break;
        camera.centerX += cosYaw * offsetX - sinPitch * sinYaw * offsetY;
        camera.centerY += cosPitch * offsetY;
        camera.centerZ = (camera.centerZ ?? 0) - sinYaw * offsetX - sinPitch * cosYaw * offsetY;
        box = bounds();
    }
    camera.scale = Math.max(0.00001, Math.min(6,
        width * 0.84 / Math.max(1, box.right - box.left),
        height * 0.84 / Math.max(1, box.bottom - box.top)));
    return true;
}
