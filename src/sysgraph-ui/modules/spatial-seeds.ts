import { createDepths } from '../engine/projection.js';
import type { FGNode } from './graph-ui-types.js';

/** Keep authored height in 3D while leaving geographic globe depth in control. */
export function seedDepths(nodes: readonly FGNode[], positions: Float32Array,
    globeDepths: Float32Array | null): Float32Array {
    const depths = globeDepths ?? createDepths(positions);
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        if (!globeDepths && Number.isFinite(node.authoredZ)) depths[i] = node.authoredZ!;
        if (Number.isFinite(node.fz)) depths[i] = node.fz!;
    }
    return depths;
}

/** Restore a geography's authored map after its globe coordinates were shown. */
export function restorePlanarGeography(nodes: readonly FGNode[]): boolean {
    if (!nodes.length || !nodes.every(node =>
        Number.isFinite(node.authoredX) && Number.isFinite(node.authoredY) &&
        Number.isFinite(node.properties?.lat) && Number.isFinite(node.properties?.lon))) return false;
    for (const node of nodes) {
        if (node.fx !== undefined || node.fy !== undefined) continue;
        node.x = node.authoredX;
        node.y = node.authoredY;
    }
    return true;
}
