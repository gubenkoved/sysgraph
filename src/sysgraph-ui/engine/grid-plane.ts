/** Fixed world XY bounds for the 3D grid, independent of the camera. */
export function gridPlaneBounds(nodes: Float32Array): Float32Array {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < nodes.length; i += 4) {
        const x = nodes[i]!, y = nodes[i + 1]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }

    if (!Number.isFinite(minX)) return Float32Array.of(0, 0, 5000, 5000);
    const halfExtent = Math.max(5000, 3 * Math.max(maxX - minX, maxY - minY, 100));
    return Float32Array.of((minX + maxX) / 2, (minY + maxY) / 2, halfExtent, halfExtent);
}
