export type Topology = 'clustered' | 'cross-linked';

export interface GraphRequest {
    id: number;
    nodeCount: number;
    edgeCount: number;
    topology: Topology;
}

export interface GraphResponse extends GraphRequest {
    nodes: Float32Array;
    edges: Uint32Array;
    generationMs: number;
}

const CLUSTERS = 12;
const TAU = Math.PI * 2;

function makeRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
}

function generate(request: GraphRequest): GraphResponse {
    const started = performance.now();
    const { nodeCount, edgeCount, topology } = request;
    const random = makeRandom(0x65b3a71f ^ nodeCount ^ edgeCount);

    // One vec4f per node: x, y, cluster index, world-space radius.
    const nodes = new Float32Array(nodeCount * 4);
    for (let i = 0; i < nodeCount; i++) {
        const cluster = i % CLUSTERS;
        const angle = cluster / CLUSTERS * TAU - Math.PI / 2;
        const centerX = Math.cos(angle) * 850;
        const centerY = Math.sin(angle) * 570;
        const localAngle = random() * TAU;
        const localRadius = Math.sqrt(random()) * (165 + Math.sqrt(nodeCount / CLUSTERS) * 1.6);
        nodes[i * 4] = centerX + Math.cos(localAngle) * localRadius;
        nodes[i * 4 + 1] = centerY + Math.sin(localAngle) * localRadius;
        nodes[i * 4 + 2] = cluster;
        nodes[i * 4 + 3] = 5 + random() * 3 + (i % 37 === 0 ? 5 : 0);
    }

    // Endpoints are numeric node indices. The topology stays fixed after upload.
    const edges = new Uint32Array(edgeCount * 2);
    const localFraction = topology === 'clustered' ? 0.88 : 0.45;
    for (let i = 0; i < edgeCount; i++) {
        const source = Math.floor(random() * nodeCount);
        let target: number;
        if (random() < localFraction) {
            const cluster = source % CLUSTERS;
            const members = Math.ceil((nodeCount - cluster) / CLUSTERS);
            target = cluster + Math.floor(random() * members) * CLUSTERS;
        } else {
            target = Math.floor(random() * nodeCount);
        }
        if (target === source) target = (target + 1) % nodeCount;
        edges[i * 2] = source;
        edges[i * 2 + 1] = target;
    }

    return { ...request, nodes, edges, generationMs: performance.now() - started };
}

self.onmessage = (event: MessageEvent<GraphRequest>) => {
    const response = generate(event.data);
    self.postMessage(response, { transfer: [response.nodes.buffer, response.edges.buffer] });
};
