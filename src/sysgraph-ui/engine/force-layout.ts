/**
 * A dense, Hilbert-indexed bottom-up quadtree. Each leaf owns a spatial bucket;
 * parallel integer atomics build leaves, then seven reduction passes build the
 * tree. This keeps the positions on the GPU and avoids a sort on every tick.
 * In 3D, XY still selects buckets while each cell accumulates an XYZ center of
 * mass; leaf interactions and springs use full XYZ distance.
 */
const GRID_BITS = 7;
const GRID_WIDTH = 1 << GRID_BITS;
const LEAF_COUNT = GRID_WIDTH * GRID_WIDTH;
const LEAF_OFFSET = (LEAF_COUNT - 1) / 3;
const TREE_COUNT = LEAF_OFFSET + LEAF_COUNT;
const WORKGROUP_SIZE = 128;

export interface LayoutProfile {
    charge: number;
    linkStrength: number;
    collisionMultiplier: number;
    velocityDecay: number;
    forceXYStrength: number;
}

export const DEFAULT_LAYOUT_PROFILE: LayoutProfile = {
    charge: -400, linkStrength: 0.8, collisionMultiplier: 1,
    velocityDecay: 0.4, forceXYStrength: 0.1,
};

const SHADER = /* wgsl */ `
override LEVEL: u32 = 0u;
const GRID_WIDTH: u32 = 128u;
const LEAF_OFFSET: u32 = 5461u;
const FIXED_SCALE: f32 = 16384.0;

struct Params {
    center: vec2f,
    side: f32,
    charge: f32,
    nodeCount: u32,
    spring: f32,
    rest: f32,
    gravity: f32,
    damping: f32,
    theta: f32,
    maxStep: f32,
    collision: f32,
    centerZ: f32,
    dimensions: u32,
}

struct Bucket {
    count: atomic<u32>,
    sumX: atomic<i32>,
    sumY: atomic<i32>,
    sumZ: atomic<i32>,
    head: atomic<u32>,
}

struct TreeNode {
    centerOfMass: vec3f,
    mass: f32,
    cellCenter: vec2f,
    padding: vec2f,
}

@group(0) @binding(0) var<storage, read> inputNodes: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outputNodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> adjacency: array<u32>;
@group(0) @binding(3) var<storage, read_write> buckets: array<Bucket>;
@group(0) @binding(4) var<storage, read_write> nextNode: array<u32>;
@group(0) @binding(5) var<storage, read_write> tree: array<TreeNode>;
@group(0) @binding(6) var<storage, read_write> velocity: array<vec4f>;
@group(0) @binding(7) var<storage, read> hilbertCell: array<u32>;
@group(0) @binding(8) var<uniform> params: Params;

fn cellIndex(position: vec2f) -> u32 {
    let xy = clamp((position - params.center) / params.side + vec2f(0.5),
                   vec2f(0.0), vec2f(0.999999)) * f32(GRID_WIDTH);
    let grid = vec2u(xy);
    return hilbertCell[grid.y * GRID_WIDTH + grid.x];
}

@compute @workgroup_size(128)
fn deposit(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (index >= params.nodeCount) { return; }
    let position = inputNodes[index].xyz;
    let cell = cellIndex(position.xy);
    let local = clamp((position.xy - params.center) / params.side, vec2f(-0.49), vec2f(0.49));
    let localZ = clamp((position.z - params.centerZ) / params.side, -0.49, 0.49);
    atomicAdd(&buckets[cell].count, 1u);
    atomicAdd(&buckets[cell].sumX, i32(round(local.x * FIXED_SCALE)));
    atomicAdd(&buckets[cell].sumY, i32(round(local.y * FIXED_SCALE)));
    atomicAdd(&buckets[cell].sumZ, i32(round(localZ * FIXED_SCALE)));
    nextNode[index] = atomicExchange(&buckets[cell].head, index + 1u);
}

@compute @workgroup_size(128)
fn makeLeaves(@builtin(global_invocation_id) id: vec3u) {
    let cell = id.x;
    if (cell >= 16384u) { return; }
    let count = atomicLoad(&buckets[cell].count);
    let cellCenter = tree[LEAF_OFFSET + cell].cellCenter;
    var com = vec3f(params.center + cellCenter * params.side, params.centerZ);
    if (count > 0u) {
        let local = vec2f(f32(atomicLoad(&buckets[cell].sumX)),
                          f32(atomicLoad(&buckets[cell].sumY))) / (f32(count) * FIXED_SCALE);
        let localZ = f32(atomicLoad(&buckets[cell].sumZ)) / (f32(count) * FIXED_SCALE);
        com = vec3f(params.center + local * params.side, params.centerZ + localZ * params.side);
    }
    tree[LEAF_OFFSET + cell] = TreeNode(com, f32(count), cellCenter, vec2f(0.0));
}

@compute @workgroup_size(128)
fn makeParents(@builtin(global_invocation_id) id: vec3u) {
    let width = 1u << LEVEL;
    let parent = id.x;
    if (parent >= width * width) { return; }
    let parentOffset = ((1u << (2u * LEVEL)) - 1u) / 3u;
    let childOffset = ((1u << (2u * (LEVEL + 1u))) - 1u) / 3u;
    let first = childOffset + parent * 4u;
    var mass = 0.0;
    var weighted = vec3f(0.0);
    var center = vec2f(0.0);
    for (var child = 0u; child < 4u; child++) {
        let item = tree[first + child];
        mass += item.mass;
        weighted += item.centerOfMass * item.mass;
        center += item.cellCenter;
    }
    center *= 0.25;
    let com = select(vec3f(params.center + center * params.side, params.centerZ),
                     weighted / max(mass, 1.0), mass > 0.0);
    tree[parentOffset + parent] = TreeNode(com, mass, center, vec2f(0.0));
}

fn repel(position: vec3f, other: vec3f, mass: f32, selfIndex: u32, otherIndex: u32) -> vec3f {
    var delta = position - other;
    if (params.dimensions == 2u) { delta.z = 0.0; }
    if (dot(delta, delta) < 0.0001) {
        let angle = f32((selfIndex * 1664525u + otherIndex * 1013904223u) & 1023u) * 0.006135923;
        delta = vec3f(cos(angle), sin(angle), select(0.0, sin(angle * 1.7), params.dimensions == 3u));
    }
    let distanceSquared = max(dot(delta, delta), 36.0);
    return delta * (params.charge * mass / distanceSquared);
}

@compute @workgroup_size(128)
fn moveNodes(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (index >= params.nodeCount) { return; }
    if (inputNodes[index].w < 0.0) {
        velocity[index] = vec4f(0.0);
        outputNodes[index] = inputNodes[index];
        return;
    }
    let position = inputNodes[index].xyz;
    var force = vec3f(0.0);
    var linkCorrection = vec3f(0.0);

    let begin = adjacency[index];
    let end = adjacency[index + 1u];
    let degree = max(1.0, f32(end - begin));
    for (var arc = begin; arc < end; arc++) {
        let base = params.nodeCount + 1u + arc * 2u;
        let neighbor = adjacency[base];
        let edgeRest = bitcast<f32>(adjacency[base + 1u]);
        let rest = select(params.rest, edgeRest, edgeRest > 0.0);
        var delta = inputNodes[neighbor].xyz - position;
        if (params.dimensions == 2u) { delta.z = 0.0; }
        let distance = max(length(delta), 0.001);
        linkCorrection += delta * ((distance - rest) / distance);
    }

    var stack: array<vec2u, 32>;
    stack[0] = vec2u(0u, 0u);
    var pending = 1u;
    loop {
        if (pending == 0u) { break; }
        pending -= 1u;
        let entry = stack[pending];
        let node = tree[entry.x];
        if (node.mass == 0.0) { continue; }
        let width = params.side / f32(1u << entry.y);
        let cellCenter = params.center + node.cellCenter * params.side;
        let inCell = all(abs(position.xy - cellCenter) <= vec2f(width * 0.5 + 0.001));
        var delta = position - node.centerOfMass;
        if (params.dimensions == 2u) { delta.z = 0.0; }
        let distance = max(length(delta), 0.001);
        if (!inCell && width / distance < params.theta) {
            force += repel(position, node.centerOfMass, node.mass, index, entry.x);
            continue;
        }
        if (entry.y == 7u) {
            let cell = entry.x - LEAF_OFFSET;
            if (node.mass > 128.0) {
                var mass = node.mass;
                var com = node.centerOfMass;
                if (inCell && mass > 1.0) {
                    com = (com * mass - position) / (mass - 1.0);
                    mass -= 1.0;
                } else if (inCell) {
                    mass = 0.0;
                }
                if (mass > 0.0) { force += repel(position, com, mass, index, entry.x); }
            } else {
                var cursor = atomicLoad(&buckets[cell].head);
                loop {
                    if (cursor == 0u) { break; }
                    let other = cursor - 1u;
                    if (other != index) {
                        let otherPosition = inputNodes[other].xyz;
                        force += repel(position, otherPosition, 1.0, index, other);
                        if (params.collision > 0.0) {
                            var direction = position - otherPosition;
                            if (params.dimensions == 2u) { direction.z = 0.0; }
                            var distance = length(direction);
                            if (distance < 0.001) {
                                let first = min(index, other);
                                let second = max(index, other);
                                let angle = f32((first * 1664525u + second * 1013904223u) & 1023u) * 0.006135923;
                                direction = vec3f(cos(angle), sin(angle),
                                    select(0.0, sin(angle * 1.7), params.dimensions == 3u))
                                    * select(-1.0, 1.0, index < other);
                                distance = 0.001;
                            } else { direction /= distance; }
                            let spacing = 12.0 * params.collision +
                                abs(inputNodes[index].w) + abs(inputNodes[other].w);
                            force += direction * max(0.0, spacing - distance) * 0.08;
                        }
                    }
                    cursor = nextNode[other];
                }
            }
            continue;
        }
        let nextLevel = entry.y + 1u;
        let nextOffset = ((1u << (2u * nextLevel)) - 1u) / 3u;
        let levelOffset = ((1u << (2u * entry.y)) - 1u) / 3u;
        let first = nextOffset + (entry.x - levelOffset) * 4u;
        for (var child = 0u; child < 4u; child++) {
            stack[pending] = vec2u(first + child, nextLevel);
            pending += 1u;
        }
    }

    force += (vec3f(params.center, params.centerZ) - position) * params.gravity;
    // Relax links independently of the slow, capped motion of the other forces.
    // Averaging by degree keeps hubs stable; pinned neighbors still pull normally.
    var linkStep = linkCorrection * (params.spring / degree);
    let linkStepLength = length(linkStep);
    // Let stronger links recover from large drags faster as well as hold their
    // rest length more closely; a fixed cap would hide the slider at high strain.
    let maxLinkStep = min(64.0, params.maxStep * 20.0 * params.spring);
    if (linkStepLength > maxLinkStep) { linkStep *= maxLinkStep / linkStepLength; }
    var speed = velocity[index].xyz * params.damping + force * 0.13;
    let speedLength = length(speed);
    if (speedLength > params.maxStep) { speed *= params.maxStep / speedLength; }
    let halfSide = params.side * 0.49;
    var nextPosition = clamp(position + speed + linkStep,
                             vec3f(params.center, params.centerZ) - vec3f(halfSide),
                             vec3f(params.center, params.centerZ) + vec3f(halfSide));
    if (any(nextPosition != position + speed + linkStep)) { speed = vec3f(0.0); }
    if (params.dimensions == 2u) { nextPosition.z = position.z; speed.z = 0.0; }
    velocity[index] = vec4f(speed, 0.0);
    outputNodes[index] = vec4f(nextPosition, inputNodes[index].w);
}
`;

function hilbertCellOrder(): { codes: Uint32Array; leafCenters: Float32Array } {
    const codes = new Uint32Array(LEAF_COUNT);
    const leafCenters = new Float32Array(LEAF_COUNT * 2);
    // Decode the Hilbert curve once. The GPU only does a lookup while ticking.
    for (let code = 0; code < LEAF_COUNT; code++) {
        let x = 0, y = 0, value = code;
        for (let scale = 1; scale < GRID_WIDTH; scale *= 2) {
            const rx = 1 & (value >> 1);
            const ry = 1 & (value ^ rx);
            if (ry === 0) {
                if (rx === 1) {
                    x = scale - 1 - x;
                    y = scale - 1 - y;
                }
                [x, y] = [y, x];
            }
            x += scale * rx;
            y += scale * ry;
            value >>= 2;
        }
        codes[y * GRID_WIDTH + x] = code;
        leafCenters[code * 2] = (x + 0.5) / GRID_WIDTH - 0.5;
        leafCenters[code * 2 + 1] = (y + 0.5) / GRID_WIDTH - 0.5;
    }
    return { codes, leafCenters };
}

function adjacencyArray(nodeCount: number, edges: Uint32Array, distances?: Float32Array): Uint32Array {
    if (distances && distances.length !== edges.length / 2) throw new Error('Edge distance count does not match the graph.');
    const data = new Uint32Array(nodeCount + 1 + edges.length * 2);
    const floats = new Float32Array(data.buffer);
    for (let i = 0; i < edges.length; i++) {
        const endpoint = edges[i]!;
        if (endpoint >= nodeCount) throw new Error('Edge endpoint exceeds node count.');
        data[endpoint + 1]!++;
    }
    for (let i = 0; i < nodeCount; i++) data[i + 1]! += data[i]!;
    const cursor = data.slice(0, nodeCount);
    const offset = nodeCount + 1;
    for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i]!;
        const b = edges[i + 1]!;
        const rest = distances?.[i / 2] ?? 0;
        data[offset + cursor[a]! * 2] = b;
        floats[offset + cursor[a]! * 2 + 1] = rest;
        cursor[a]!++;
        data[offset + cursor[b]! * 2] = a;
        floats[offset + cursor[b]! * 2 + 1] = rest;
        cursor[b]!++;
    }
    return data;
}

export class GpuForceLayout {
    private static readonly pipelineCache = new WeakMap<GPUDevice, Promise<{
        layout: GPUBindGroupLayout;
        pipelines: { deposit: GPUComputePipeline; leaf: GPUComputePipeline;
            parents: GPUComputePipeline[]; move: GPUComputePipeline };
    }>>();
    private readonly device: GPUDevice;
    private readonly buffers: GPUBuffer[];
    private readonly groups: GPUBindGroup[];
    private readonly depositPipeline: GPUComputePipeline;
    private readonly leafPipeline: GPUComputePipeline;
    private readonly parentPipelines: GPUComputePipeline[];
    private readonly movePipeline: GPUComputePipeline;
    private readonly buckets: GPUBuffer;
    private readonly adjacency: GPUBuffer;
    private readonly next: GPUBuffer;
    private readonly tree: GPUBuffer;
    private readonly velocity: GPUBuffer;
    private readonly codes: GPUBuffer;
    private readonly params: GPUBuffer;
    private readonly nodeCount: number;
    private readonly initialNodes: Float32Array;
    private readonly parameterData: ArrayBuffer;
    private readonly parameterFloats: Float32Array;
    private readonly parameterWords: Uint32Array;
    private tickCount = 0;
    activeIndex = 0;
    readonly bytes: number;

    private constructor(device: GPUDevice, nodes: Float32Array, edges: Uint32Array, buffers: GPUBuffer[], distances: Float32Array | undefined,
                        profile: LayoutProfile, dimensions: 2 | 3,
                        pipelines: { deposit: GPUComputePipeline; leaf: GPUComputePipeline; parents: GPUComputePipeline[]; move: GPUComputePipeline },
                        layout: GPUBindGroupLayout) {
        this.device = device;
        this.buffers = buffers;
        this.nodeCount = nodes.length / 4;
        this.initialNodes = nodes.slice();
        const adjacencyData = adjacencyArray(this.nodeCount, edges, distances);
        const order = hilbertCellOrder();
        const treeData = new Float32Array(TREE_COUNT * 8);
        for (let cell = 0; cell < LEAF_COUNT; cell++) {
            treeData[(LEAF_OFFSET + cell) * 8 + 4] = order.leafCenters[cell * 2]!;
            treeData[(LEAF_OFFSET + cell) * 8 + 5] = order.leafCenters[cell * 2 + 1]!;
        }
        const makeBuffer = (label: string, data: ArrayBufferView | number, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST): GPUBuffer => {
            const buffer = device.createBuffer({ size: typeof data === 'number' ? data : data.byteLength, usage, label });
            if (typeof data !== 'number') device.queue.writeBuffer(buffer, 0, data);
            return buffer;
        };
        this.adjacency = makeBuffer('force layout adjacency', adjacencyData);
        this.buckets = makeBuffer('force layout Hilbert buckets', LEAF_COUNT * 20);
        this.next = makeBuffer('force layout bucket links', this.nodeCount * 4);
        this.tree = makeBuffer('force layout quadtree', treeData);
        this.velocity = makeBuffer('force layout velocities', this.nodeCount * 16);
        this.codes = makeBuffer('force layout Hilbert cell lookup', order.codes);
        this.params = makeBuffer('force layout parameters', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.depositPipeline = pipelines.deposit;
        this.leafPipeline = pipelines.leaf;
        this.parentPipelines = pipelines.parents;
        this.movePipeline = pipelines.move;
        this.groups = [0, 1].map(index => device.createBindGroup({ layout, entries: [
            { binding: 0, resource: { buffer: buffers[index]! } },
            { binding: 1, resource: { buffer: buffers[1 - index]! } },
            { binding: 2, resource: { buffer: this.adjacency } },
            { binding: 3, resource: { buffer: this.buckets } },
            { binding: 4, resource: { buffer: this.next } },
            { binding: 5, resource: { buffer: this.tree } },
            { binding: 6, resource: { buffer: this.velocity } },
            { binding: 7, resource: { buffer: this.codes } },
            { binding: 8, resource: { buffer: this.params } },
        ] }));
        this.parameterData = new ArrayBuffer(64);
        this.parameterFloats = new Float32Array(this.parameterData);
        this.parameterWords = new Uint32Array(this.parameterData);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < nodes.length; i += 4) {
            minX = Math.min(minX, nodes[i]!);
            maxX = Math.max(maxX, nodes[i]!);
            minY = Math.min(minY, nodes[i + 1]!);
            maxY = Math.max(maxY, nodes[i + 1]!);
            minZ = Math.min(minZ, nodes[i + 2]!);
            maxZ = Math.max(maxZ, nodes[i + 2]!);
        }
        const side = Math.max(maxX - minX, maxY - minY, dimensions === 3 ? maxZ - minZ : 0, 100) * 4;
        const count = Math.max(1, this.nodeCount);
        this.parameterFloats.set([(minX + maxX) * 0.5, (minY + maxY) * 0.5, side]);
        this.parameterWords[4] = this.nodeCount;
        this.parameterFloats[6] = Math.max(35, Math.min(90, side / Math.sqrt(count) * 1.3));
        this.parameterFloats[9] = 0.85;
        this.parameterFloats[10] = Math.max(3, Math.min(12, side / 900));
        this.parameterFloats[12] = (minZ + maxZ) * 0.5;
        this.parameterWords[13] = dimensions;
        this.updateProfile(profile);
        this.bytes = adjacencyData.byteLength + LEAF_COUNT * 20 + this.nodeCount * 20 + treeData.byteLength + order.codes.byteLength + 64;
    }

    /** Apply force sliders without recreating the graph or losing GPU positions. */
    updateProfile(profile: LayoutProfile): void {
        const count = Math.max(1, this.nodeCount);
        this.parameterFloats[3] = Math.max(0, -profile.charge) * 0.00175 * Math.sqrt(10000 / count);
        // At 2.0 an isolated free edge corrects 96% of a small length error in
        // one tick. Keep each endpoint below 0.5 to avoid overshooting.
        this.parameterFloats[5] = Math.min(0.48, Math.max(0, profile.linkStrength) * 0.24);
        this.parameterFloats[7] = Math.max(0, profile.forceXYStrength) * 0.003;
        this.parameterFloats[8] = 1 - Math.max(0, Math.min(0.95, profile.velocityDecay));
        this.parameterFloats[11] = Math.max(0, profile.collisionMultiplier);
        this.device.queue.writeBuffer(this.params, 0, this.parameterData);
    }

    setDimensions(dimensions: 2 | 3): void {
        this.parameterWords[13] = dimensions;
        this.device.queue.writeBuffer(this.params, 0, this.parameterData);
    }

    /** Keep the quadtree and movable-node bounds around a dragged pin. */
    includePinnedPosition(x: number, y: number): void {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const centerX = this.parameterFloats[0]!;
        const centerY = this.parameterFloats[1]!;
        const neededSide = Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) * 2.5;
        if (neededSide <= this.parameterFloats[2]!) return;
        const side = Math.max(this.parameterFloats[2]! * 1.25, neededSide);
        this.parameterFloats[2] = side;
        this.parameterFloats[10] = Math.max(3, Math.min(12, side / 900));
        this.device.queue.writeBuffer(this.params, 0, this.parameterData);
    }

    static async create(device: GPUDevice, nodes: Float32Array, edges: Uint32Array, buffers: GPUBuffer[],
                        distances?: Float32Array, isCurrent?: () => boolean,
                        profile: LayoutProfile = DEFAULT_LAYOUT_PROFILE, dimensions: 2 | 3 = 2): Promise<GpuForceLayout | null> {
        let shared = GpuForceLayout.pipelineCache.get(device);
        if (!shared) {
            shared = (async () => {
                const layout = device.createBindGroupLayout({ entries: [
                    ...Array.from({ length: 8 }, (_, binding) => ({
                        binding, visibility: GPUShaderStage.COMPUTE,
                        buffer: { type: binding === 0 || binding === 2 || binding === 7 ? 'read-only-storage' : 'storage' } as GPUBufferBindingLayout,
                    })),
                    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                ] });
                const module = device.createShaderModule({ code: SHADER, label: 'Hilbert quadtree force layout' });
                const diagnostics = await module.getCompilationInfo();
                const errors = diagnostics.messages.filter(message => message.type === 'error');
                if (errors.length) throw new Error(`Force-layout WGSL failed: ${errors.map(error => error.message).join('; ')}`);
                const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
                const create = (entryPoint: string, constants?: Record<string, number>) =>
                    device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module, entryPoint, constants } });
                const [deposit, leaf, move, ...parents] = await Promise.all([
                    create('deposit'), create('makeLeaves'), create('moveNodes'),
                    ...Array.from({ length: GRID_BITS }, (_, level) => create('makeParents', { LEVEL: level })),
                ]);
                return { layout, pipelines: { deposit, leaf, move, parents } };
            })();
            GpuForceLayout.pipelineCache.set(device, shared);
        }
        let resources: Awaited<typeof shared>;
        try { resources = await shared; }
        catch (error) {
            if (GpuForceLayout.pipelineCache.get(device) === shared) GpuForceLayout.pipelineCache.delete(device);
            throw error;
        }
        if (isCurrent && !isCurrent()) return null;
        return new GpuForceLayout(device, nodes, edges, buffers, distances, profile, dimensions,
            resources.pipelines, resources.layout);
    }

    encode(encoder: GPUCommandEncoder): number {
        this.tickCount++;
        encoder.clearBuffer(this.buckets);
        const group = this.groups[this.activeIndex]!;
        const dispatch = (pipeline: GPUComputePipeline, items: number): void => {
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.dispatchWorkgroups(Math.ceil(items / WORKGROUP_SIZE));
            pass.end();
        };
        dispatch(this.depositPipeline, this.nodeCount);
        dispatch(this.leafPipeline, LEAF_COUNT);
        for (let level = GRID_BITS - 1; level >= 0; level--) {
            dispatch(this.parentPipelines[level]!, 1 << (2 * level));
        }
        dispatch(this.movePipeline, this.nodeCount);
        this.activeIndex = 1 - this.activeIndex;
        return this.activeIndex;
    }

    reset(): void {
        this.tickCount = 0;
        this.activeIndex = 0;
        for (let i = 3; i < this.initialNodes.length; i += 4) this.initialNodes[i] = Math.abs(this.initialNodes[i]!);
        this.device.queue.writeBuffer(this.buffers[0]!, 0, this.initialNodes);
        this.device.queue.writeBuffer(this.buffers[1]!, 0, this.initialNodes);
        this.device.queue.writeBuffer(this.velocity, 0, new Uint8Array(this.nodeCount * 16));
    }

    setNodeRadii(radii: Float32Array): void {
        if (radii.length !== this.nodeCount) return;
        for (let i = 0; i < radii.length; i++) this.initialNodes[i * 4 + 3] = radii[i]!;
    }

    get ticks(): number { return this.tickCount; }

    clearVelocity(node: number): void {
        this.device.queue.writeBuffer(this.velocity, node * 16, new Float32Array(4));
    }

    destroy(): void {
        this.adjacency.destroy();
        this.buckets.destroy();
        this.next.destroy();
        this.tree.destroy();
        this.velocity.destroy();
        this.codes.destroy();
        this.params.destroy();
    }
}
