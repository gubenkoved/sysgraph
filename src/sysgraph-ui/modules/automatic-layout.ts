import type { FGLink, FGNode } from './graph-ui-types.js';

export type LayoutMode = 'force' | 'layered' | 'radial' | 'circular' | 'concentric' | 'grid';
export type StaticLayoutMode = Exclude<LayoutMode, 'force'>;
export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface AutomaticLayoutOptions {
    mode: StaticLayoutMode;
    spacing: number;
    rankSpacing: number;
    direction: LayoutDirection;
    rootId: string;
}

interface Component {
    nodes: number[];
    minX: number;
    minY: number;
    width: number;
    height: number;
}

interface LayeredScratch {
    indegree: Int32Array;
    rank: Int32Array;
    placed: Uint8Array;
    position: Int32Array;
    score: Float64Array;
}

function pinned(node: FGNode): boolean { return node.fx !== undefined || node.fy !== undefined; }

function mostConnected(indices: number[], adjacency: number[][], preferred: number | undefined): number {
    if (preferred !== undefined && indices.includes(preferred)) return preferred;
    let best = indices[0]!;
    for (const index of indices) {
        if (adjacency[index]!.length > adjacency[best]!.length) best = index;
    }
    return best;
}

function bfsOrder(indices: number[], adjacency: number[][], root: number, visited: Uint8Array): number[] {
    const queue = [root];
    visited[root] = 1;
    for (let head = 0; head < queue.length; head++) {
        for (const neighbor of adjacency[queue[head]!]!) {
            if (visited[neighbor]) continue;
            visited[neighbor] = 1;
            queue.push(neighbor);
        }
    }
    // Components are connected by construction, but keep isolated vertices safe.
    for (const index of indices) if (!visited[index]) { visited[index] = 1; queue.push(index); }
    return queue;
}

function placeCircular(indices: number[], adjacency: number[][], output: Float32Array, spacing: number,
    preferred: number | undefined, visited: Uint8Array): void {
    const order = bfsOrder(indices, adjacency, mostConnected(indices, adjacency, preferred), visited);
    const radius = Math.max(spacing, order.length * spacing / (2 * Math.PI));
    for (let i = 0; i < order.length; i++) {
        const angle = 2 * Math.PI * i / order.length - Math.PI / 2;
        output[order[i]! * 2] = Math.cos(angle) * radius;
        output[order[i]! * 2 + 1] = Math.sin(angle) * radius;
    }
}

function placeRadial(indices: number[], adjacency: number[][], output: Float32Array, spacing: number,
    rankSpacing: number, preferred: number | undefined, depth: Int32Array): void {
    const root = mostConnected(indices, adjacency, preferred);
    const queue = [root];
    const layers: number[][] = [[root]];
    depth[root] = 0;
    for (let head = 0; head < queue.length; head++) {
        const index = queue[head]!;
        const nextDepth = depth[index]! + 1;
        for (const neighbor of adjacency[index]!) {
            if (depth[neighbor] !== -1) continue;
            depth[neighbor] = nextDepth;
            if (!layers[nextDepth]) layers[nextDepth] = [];
            layers[nextDepth]!.push(neighbor);
            queue.push(neighbor);
        }
    }
    output[root * 2] = 0;
    output[root * 2 + 1] = 0;
    let radius = 0;
    for (let level = 1; level < layers.length; level++) {
        const layer = layers[level]!;
        radius = Math.max(radius + rankSpacing, layer.length * spacing / (2 * Math.PI));
        for (let position = 0; position < layer.length; position++) {
            const angle = 2 * Math.PI * position / layer.length - Math.PI / 2;
            output[layer[position]! * 2] = Math.cos(angle) * radius;
            output[layer[position]! * 2 + 1] = Math.sin(angle) * radius;
        }
    }
}

function placeConcentric(indices: number[], adjacency: number[][], output: Float32Array, spacing: number,
    rankSpacing: number): void {
    const order = [...indices].sort((a, b) => adjacency[b]!.length - adjacency[a]!.length || a - b);
    output[order[0]! * 2] = 0;
    output[order[0]! * 2 + 1] = 0;
    let cursor = 1;
    let radius = 0;
    while (cursor < order.length) {
        radius += rankSpacing;
        const count = Math.min(order.length - cursor, Math.max(6, Math.floor(2 * Math.PI * radius / spacing)));
        radius = Math.max(radius, count * spacing / (2 * Math.PI));
        for (let i = 0; i < count; i++) {
            const angle = 2 * Math.PI * i / count - Math.PI / 2;
            output[order[cursor + i]! * 2] = Math.cos(angle) * radius;
            output[order[cursor + i]! * 2 + 1] = Math.sin(angle) * radius;
        }
        cursor += count;
    }
}

function placeGrid(indices: number[], nodes: readonly FGNode[], output: Float32Array, spacing: number): void {
    const coordinates = new Set<string>();
    const authoredGrid = indices.every(index => {
        const row = Number(nodes[index]!.properties?.row);
        const col = Number(nodes[index]!.properties?.col);
        const key = `${row}:${col}`;
        if (!Number.isFinite(row) || !Number.isFinite(col) || coordinates.has(key)) return false;
        coordinates.add(key);
        return true;
    });
    if (authoredGrid) {
        let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
        for (const index of indices) {
            const row = Number(nodes[index]!.properties!.row);
            const col = Number(nodes[index]!.properties!.col);
            minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
            minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
        }
        for (const index of indices) {
            output[index * 2] = (Number(nodes[index]!.properties!.col) - (minCol + maxCol) / 2) * spacing;
            output[index * 2 + 1] = (Number(nodes[index]!.properties!.row) - (minRow + maxRow) / 2) * spacing;
        }
        return;
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(indices.length * 1.5)));
    const rows = Math.ceil(indices.length / columns);
    for (let i = 0; i < indices.length; i++) {
        output[indices[i]! * 2] = ((i % columns) - (columns - 1) / 2) * spacing;
        output[indices[i]! * 2 + 1] = (Math.floor(i / columns) - (rows - 1) / 2) * spacing;
    }
}

function placeLayered(indices: number[], outgoing: number[][], incoming: number[][], output: Float32Array,
    spacing: number, rankSpacing: number, direction: LayoutDirection, scratch: LayeredScratch): void {
    const { indegree, rank, placed, position, score } = scratch;
    for (const index of indices) {
        indegree[index] = incoming[index]!.length;
        rank[index] = 0;
        placed[index] = 0;
    }
    const candidate = [...indices].sort((a, b) =>
        (outgoing[b]!.length - incoming[b]!.length) - (outgoing[a]!.length - incoming[a]!.length) || a - b);
    const queue = indices.filter(index => indegree[index] === 0);
    let head = 0, fallback = 0, remaining = indices.length;
    while (remaining) {
        if (head >= queue.length) {
            while (placed[candidate[fallback]!]) fallback++;
            queue.push(candidate[fallback]!); // Greedily break a directed cycle.
        }
        const index = queue[head++]!;
        if (placed[index]) continue;
        placed[index] = 1;
        remaining--;
        for (const target of outgoing[index]!) {
            if (placed[target]) continue;
            rank[target] = Math.max(rank[target]!, rank[index]! + 1);
            if (--indegree[target] === 0) queue.push(target);
        }
    }
    const maxRank = indices.reduce((maximum, index) => Math.max(maximum, rank[index]!), 0);
    const layers: number[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (const index of indices) layers[rank[index]!]!.push(index);
    const positions = (): void => { for (const layer of layers) layer.forEach((node, order) => { position[node] = order; }); };
    positions();
    for (let sweep = 0; sweep < 2; sweep++) {
        for (const downward of [true, false]) {
            for (let step = 1; step < layers.length; step++) {
                const level = downward ? step : layers.length - 1 - step;
                const layer = layers[level]!;
                const adjacent = downward ? incoming : outgoing;
                for (const node of layer) {
                    let sum = 0, total = 0;
                    for (const neighbor of adjacent[node]!) {
                        if (downward ? rank[neighbor]! >= level : rank[neighbor]! <= level) continue;
                        sum += position[neighbor]! / Math.max(1, layers[rank[neighbor]!]!.length - 1);
                        total++;
                    }
                    score[node] = total ? sum / total : position[node]! / Math.max(1, layer.length - 1);
                }
                layer.sort((a, b) => score[a]! - score[b]! || position[a]! - position[b]! || a - b);
                layer.forEach((node, order) => { position[node] = order; });
            }
        }
    }
    for (let level = 0; level < layers.length; level++) {
        const layer = layers[level]!;
        for (let i = 0; i < layer.length; i++) {
            const cross = (i - (layer.length - 1) / 2) * spacing;
            const flow = level * rankSpacing;
            const node = layer[i]!;
            output[node * 2] = direction === 'LR' ? flow : direction === 'RL' ? -flow : cross;
            output[node * 2 + 1] = direction === 'TB' ? flow : direction === 'BT' ? -flow : cross;
        }
    }
}

/** Deterministic, component-aware layouts. Runs in the browser without a server round trip. */
export function calculateAutomaticLayout(nodes: readonly FGNode[], links: readonly FGLink[],
    options: AutomaticLayoutOptions): Float32Array {
    const count = nodes.length;
    const output = new Float32Array(count * 2);
    if (!count) return output;
    const spacing = Math.max(12, Math.min(500, Number(options.spacing) || 80));
    const rankSpacing = Math.max(20, Math.min(800, Number(options.rankSpacing) || 120));
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    const adjacency: number[][] = Array.from({ length: count }, () => []);
    const outgoing: number[][] = options.mode === 'layered' ? Array.from({ length: count }, () => []) : [];
    const incoming: number[][] = options.mode === 'layered' ? Array.from({ length: count }, () => []) : [];
    const parent = Int32Array.from({ length: count }, (_, index) => index);
    const find = (index: number): number => {
        while (parent[index] !== index) { parent[index] = parent[parent[index]!]!; index = parent[index]!; }
        return index;
    };
    for (const link of links) {
        const source = indexById.get(link.source_id), target = indexById.get(link.target_id);
        if (source === undefined || target === undefined || source === target) continue;
        adjacency[source]!.push(target);
        adjacency[target]!.push(source);
        if (options.mode === 'layered') { outgoing[source]!.push(target); incoming[target]!.push(source); }
        parent[find(target)] = find(source);
    }
    const groups = new Map<number, number[]>();
    for (let index = 0; index < count; index++) {
        const root = find(index);
        let group = groups.get(root);
        if (!group) { group = []; groups.set(root, group); }
        group.push(index);
    }
    if (options.mode === 'grid') {
        const cells = new Set<string>();
        const authored = nodes.every(node => {
            const row = Number(node.properties?.row), col = Number(node.properties?.col);
            const key = `${row}:${col}`;
            if (!Number.isFinite(row) || !Number.isFinite(col) || cells.has(key)) return false;
            cells.add(key);
            return true;
        });
        if (authored) {
            groups.clear();
            groups.set(0, Array.from({ length: count }, (_, index) => index));
        }
    }
    const preferred = indexById.get(String(options.rootId ?? '').trim());
    const visited = new Uint8Array(count);
    const depth = new Int32Array(count).fill(-1);
    const layeredScratch: LayeredScratch | null = options.mode === 'layered' ? {
        indegree: new Int32Array(count), rank: new Int32Array(count), placed: new Uint8Array(count),
        position: new Int32Array(count), score: new Float64Array(count),
    } : null;
    const components: Component[] = [];
    for (const indices of groups.values()) {
        switch (options.mode) {
            case 'circular': placeCircular(indices, adjacency, output, spacing, preferred, visited); break;
            case 'radial': placeRadial(indices, adjacency, output, spacing, rankSpacing, preferred, depth); break;
            case 'concentric': placeConcentric(indices, adjacency, output, spacing, rankSpacing); break;
            case 'grid': placeGrid(indices, nodes, output, spacing); break;
            case 'layered': placeLayered(indices, outgoing, incoming, output, spacing, rankSpacing,
                options.direction, layeredScratch!); break;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const index of indices) {
            const x = output[index * 2]!, y = output[index * 2 + 1]!;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        components.push({ nodes: indices, minX, minY,
            width: maxX - minX + spacing * 2, height: maxY - minY + spacing * 2 });
    }
    components.sort((a, b) => b.nodes.length - a.nodes.length || a.nodes[0]! - b.nodes[0]!);
    const targetWidth = Math.sqrt(components.reduce((sum, component) => sum + component.width * component.height, 0)) * 1.4;
    let cursorX = 0, cursorY = 0, rowHeight = 0, right = 0;
    for (const component of components) {
        if (cursorX && cursorX + component.width > targetWidth) {
            cursorX = 0; cursorY += rowHeight; rowHeight = 0;
        }
        const shiftX = cursorX + spacing - component.minX;
        const shiftY = cursorY + spacing - component.minY;
        for (const index of component.nodes) {
            output[index * 2] += shiftX;
            output[index * 2 + 1] += shiftY;
        }
        cursorX += component.width;
        right = Math.max(right, cursorX);
        rowHeight = Math.max(rowHeight, component.height);
    }
    const centerX = right / 2, centerY = (cursorY + rowHeight) / 2;
    for (let index = 0; index < count; index++) {
        output[index * 2] -= centerX;
        output[index * 2 + 1] -= centerY;
    }
    for (const component of components) {
        let dx = 0, dy = 0, pins = 0;
        for (const index of component.nodes) {
            const node = nodes[index]!;
            if (!pinned(node)) continue;
            dx += (node.fx ?? node.x ?? 0) - output[index * 2]!;
            dy += (node.fy ?? node.y ?? 0) - output[index * 2 + 1]!;
            pins++;
        }
        if (!pins) continue;
        dx /= pins; dy /= pins;
        for (const index of component.nodes) {
            const node = nodes[index]!;
            output[index * 2] = pinned(node) ? (node.fx ?? node.x ?? 0) : output[index * 2]! + dx;
            output[index * 2 + 1] = pinned(node) ? (node.fy ?? node.y ?? 0) : output[index * 2 + 1]! + dy;
        }
    }
    return output;
}
