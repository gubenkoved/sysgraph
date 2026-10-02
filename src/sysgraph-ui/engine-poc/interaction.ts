import { screenNodeRadius } from './node-size.js';
import { createProjection, projectPoint } from './projection.js';
import type { CameraState } from './renderer.js';

const CELL_SIZE = 64;

export interface GraphNeighborhood {
    firstHop: Uint32Array;
    secondHop: Uint32Array;
}

/** CPU-side index for picking and neighborhood lookup. */
export class GraphInteractionIndex {
    private readonly nodes: Float32Array;
    private readonly cells = new Map<string, number[]>();
    private readonly offsets: Uint32Array;
    private readonly neighbors: Uint32Array;
    private readonly visited: Uint32Array;
    private visitEpoch = 0;
    private maxWorldRadius = 0;

    constructor(nodes: Float32Array, edges: Uint32Array) {
        this.nodes = nodes;
        const nodeCount = nodes.length / 4;
        this.visited = new Uint32Array(nodeCount);
        this.rebuildCells();
        this.refreshRadiusBounds();

        const degrees = new Uint32Array(nodeCount);
        for (let i = 0; i < edges.length; i += 2) {
            degrees[edges[i]!]!++;
            degrees[edges[i + 1]!]!++;
        }
        this.offsets = new Uint32Array(nodeCount + 1);
        for (let i = 0; i < nodeCount; i++) this.offsets[i + 1] = this.offsets[i]! + degrees[i]!;
        this.neighbors = new Uint32Array(edges.length);
        const cursor = this.offsets.slice(0, nodeCount);
        for (let i = 0; i < edges.length; i += 2) {
            const source = edges[i]!;
            const target = edges[i + 1]!;
            this.neighbors[cursor[source]!] = target;
            cursor[source]!++;
            this.neighbors[cursor[target]!] = source;
            cursor[target]!++;
        }
    }

    private rebuildCells(): void {
        this.cells.clear();
        const nodeCount = this.nodes.length / 4;
        for (let i = 0; i < nodeCount; i++) {
            const key = this.cellKey(
                Math.floor(this.nodes[i * 4]! / CELL_SIZE),
                Math.floor(this.nodes[i * 4 + 1]! / CELL_SIZE),
            );
            const bucket = this.cells.get(key) ?? [];
            bucket.push(i);
            this.cells.set(key, bucket);
        }
    }

    updatePositions(snapshot: Float32Array): void {
        if (snapshot.length !== this.nodes.length) return;
        this.nodes.set(snapshot);
        this.rebuildCells();
        this.refreshRadiusBounds();
    }

    refreshRadiusBounds(): void {
        let maximum = 0;
        for (let i = 3; i < this.nodes.length; i += 4) maximum = Math.max(maximum, Math.abs(this.nodes[i]!));
        this.maxWorldRadius = maximum;
    }

    moveNode(node: number, x: number, y: number): void {
        const offset = node * 4;
        const oldKey = this.cellKey(
            Math.floor(this.nodes[offset]! / CELL_SIZE),
            Math.floor(this.nodes[offset + 1]! / CELL_SIZE),
        );
        const nextKey = this.cellKey(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE));
        this.nodes[offset] = x;
        this.nodes[offset + 1] = y;
        if (oldKey === nextKey) return;
        const previous = this.cells.get(oldKey);
        if (previous) {
            const index = previous.indexOf(node);
            if (index >= 0) previous.splice(index, 1);
            if (previous.length === 0) this.cells.delete(oldKey);
        }
        const next = this.cells.get(nextKey) ?? [];
        next.push(node);
        this.cells.set(nextKey, next);
    }

    private cellKey(x: number, y: number): string {
        return `${x}:${y}`;
    }

    getNeighbors(node: number): Uint32Array {
        return this.neighbors.subarray(this.offsets[node]!, this.offsets[node + 1]!);
    }

    getNeighborhood(node: number): GraphNeighborhood {
        this.visitEpoch = (this.visitEpoch + 1) >>> 0;
        if (this.visitEpoch === 0) {
            this.visited.fill(0);
            this.visitEpoch = 1;
        }
        const epoch = this.visitEpoch;
        this.visited[node] = epoch;
        const firstHop: number[] = [];
        for (const neighbor of this.getNeighbors(node)) {
            if (this.visited[neighbor] === epoch) continue;
            this.visited[neighbor] = epoch;
            firstHop.push(neighbor);
        }
        const secondHop: number[] = [];
        for (const adjacent of firstHop) {
            for (const neighbor of this.getNeighbors(adjacent)) {
                if (this.visited[neighbor] === epoch) continue;
                this.visited[neighbor] = epoch;
                secondHop.push(neighbor);
            }
        }
        return { firstHop: Uint32Array.from(firstHop), secondHop: Uint32Array.from(secondHop) };
    }

    getDegree(node: number): number {
        return this.offsets[node + 1]! - this.offsets[node]!;
    }

    pick(worldX: number, worldY: number, cssScale: number): number | null {
        const range = Math.max(7, screenNodeRadius(this.maxWorldRadius, cssScale) + 3) / cssScale;
        const minX = Math.floor((worldX - range) / CELL_SIZE);
        const maxX = Math.floor((worldX + range) / CELL_SIZE);
        const minY = Math.floor((worldY - range) / CELL_SIZE);
        const maxY = Math.floor((worldY + range) / CELL_SIZE);
        let nearest: number | null = null;
        let nearestDistanceSquared = Infinity;
        for (let cy = minY; cy <= maxY; cy++) {
            for (let cx = minX; cx <= maxX; cx++) {
                const bucket = this.cells.get(this.cellKey(cx, cy));
                if (!bucket) continue;
                for (const index of bucket) {
                    const dx = (this.nodes[index * 4]! - worldX) * cssScale;
                    const dy = (this.nodes[index * 4 + 1]! - worldY) * cssScale;
                    const distanceSquared = dx * dx + dy * dy;
                    const drawnRadius = screenNodeRadius(this.nodes[index * 4 + 3]!, cssScale);
                    const pointerRadius = Math.max(7, drawnRadius + 3);
                    if (distanceSquared <= pointerRadius * pointerRadius && distanceSquared < nearestDistanceSquared) {
                        nearest = index;
                        nearestDistanceSquared = distanceSquared;
                    }
                }
            }
        }
        return nearest;
    }

    pick3D(screenX: number, screenY: number, camera: CameraState, depths: Float32Array, width: number, height: number): number | null {
        const projection = createProjection(camera, width, height);
        const projected = { x: 0, y: 0, factor: 1 };
        let nearest: number | null = null;
        let nearestDistanceSquared = Infinity;
        for (let index = 0; index < depths.length; index++) {
            const offset = index * 4;
            projectPoint(projection, this.nodes[offset]!, this.nodes[offset + 1]!, depths[index]!, projected);
            const dx = projected.x - screenX;
            const dy = projected.y - screenY;
            const radius = screenNodeRadius(this.nodes[offset + 3]!, camera.scale, projected.factor);
            const pickRadius = Math.max(7, radius + 3);
            if (Math.abs(dx) > pickRadius || Math.abs(dy) > pickRadius) continue;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= pickRadius * pickRadius && distanceSquared < nearestDistanceSquared) {
                nearest = index;
                nearestDistanceSquared = distanceSquared;
            }
        }
        return nearest;
    }
}
