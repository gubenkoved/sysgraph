import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3';
import type { LoadedGraphData } from '../modules/data-io.js';
import { seedGeodesicGlobe } from '../modules/geodesic-layout.js';
import type { FGNode } from '../modules/graph-ui-types.js';
import { seedInitialLayout } from '../modules/initial-layout.js';
import type { LayoutProfile } from './force-layout.js';

export interface ExampleRequest {
    id: number;
    graph: LoadedGraphData;
}

export interface ExampleResponse {
    id: number;
    nodes: Float32Array;
    edges: Uint32Array;
    edgeDistances: Float32Array;
    nodeColors: Float32Array;
    edgeColors: Float32Array;
    edgeWidths: Float32Array;
    arrows: Float32Array;
    layoutProfile: LayoutProfile;
    labels: string[];
    nodeIds: string[];
    nodeCount: number;
    edgeCount: number;
    layoutMs: number;
    globe?: { nodes: Float32Array; depths: Float32Array; edgeDistances: Float32Array };
}

interface LayoutNode extends SimulationNodeDatum {
    id: string;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
    distance: number;
}

function setting(display: Record<string, unknown> | undefined, key: string, fallback: number): number {
    const value = display?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function edgeDistance(properties: Record<string, unknown> | undefined, display: Record<string, unknown> | undefined): number {
    const fallback = setting(display, 'gpuLinkDistance', setting(display, 'd3LinkDistance', 140));
    if ((display?.gpuLinkDistanceMode ?? display?.d3LinkDistanceMode) !== 'expression') return fallback;
    const expression = display?.gpuLinkDistanceExpression ?? display?.d3LinkDistanceExpression;
    const length = Number(properties?.length);
    if (!Number.isFinite(length) || length <= 0 || typeof expression !== 'string') return fallback;
    if (expression.trim() === 'length' || expression.trim() === 'properties.length') return length;
    const match = expression.match(/^Number\(properties\.length\)\s*\*\s*([\d.]+)$/);
    return match ? length * Number(match[1]) : fallback;
}

function color(map: unknown, type: string, fallback: readonly number[]): number[] {
    const entry = map && typeof map === 'object' ? (map as Record<string, unknown>)[type] : null;
    if (!entry || typeof entry !== 'object') return [...fallback];
    const rgba = entry as Record<string, unknown>;
    return ['r', 'g', 'b'].map((channel, index) =>
        typeof rgba[channel] === 'number' ? Math.max(0, Math.min(255, rgba[channel])) / 255 : fallback[index]!)
        .concat(typeof rgba.a === 'number' ? Math.max(0, Math.min(1, rgba.a)) : fallback[3]!);
}

function edgeWidth(map: unknown, type: string): number {
    const value = map && typeof map === 'object' ? (map as Record<string, unknown>)[type] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.1, value) : 1;
}

function makeExample(request: ExampleRequest): ExampleResponse {
    const started = performance.now();
    const { graph } = request;
    const sourceNodes = graph.nodes;
    const nodeCount = sourceNodes.length;
    const indexById = new Map(sourceNodes.map((node, index) => [node.id, index]));
    const typeIndex = new Map<string, number>();
    const layoutNodes: LayoutNode[] = sourceNodes.map(node => ({ id: node.id }));
    const nodeIds = sourceNodes.map(node => node.id);
    const labels = sourceNodes.map(node => {
        const value = node.properties?.label ?? node.properties?.name;
        return typeof value === 'string' && value.trim() ? value.trim() : node.id;
    });
    const links: LayoutLink[] = [];
    const endpoints: number[] = [];
    const distances: number[] = [];
    const edgeColors: number[] = [];
    const edgeWidths: number[] = [];
    const arrows: number[] = [];
    const layoutProfile: LayoutProfile = {
        charge: setting(graph.display, 'gpuCharge', setting(graph.display, 'd3Charge', -400)),
        linkStrength: setting(graph.display, 'gpuLinkStrength', setting(graph.display, 'd3LinkStrength', 0.8)),
        collisionMultiplier: setting(graph.display, 'gpuCollisionMultiplier', setting(graph.display, 'd3CollisionMultiplier', 1)),
        velocityDecay: setting(graph.display, 'gpuVelocityDecay', setting(graph.display, 'd3VelocityDecay', 0.4)),
        forceXYStrength: setting(graph.display, 'gpuForceXYStrength', setting(graph.display, 'd3ForceXYStrength', 0.1)),
    };
    for (const edge of graph.edges) {
        const source = indexById.get(edge.source_id);
        const target = indexById.get(edge.target_id);
        if (source === undefined || target === undefined) continue;
        endpoints.push(source, target);
        const distance = edgeDistance(edge.properties, graph.display);
        distances.push(distance);
        links.push({ source: edge.source_id, target: edge.target_id, distance });
        const width = edgeWidth(graph.display?.edgeWidths, edge.type);
        edgeWidths.push(width);
        edgeColors.push(...color(graph.display?.edgeColors, edge.type, [0.6, 0.75, 0.82, 0.35]));
        arrows.push(edge.properties?.directional === false ? 0 : 6 * Math.sqrt(width));
    }
    const edges = Uint32Array.from(endpoints);
    const edgeDistances = Float32Array.from(distances);

    const positionedNodes = sourceNodes as FGNode[];
    const seed = seedInitialLayout(positionedNodes, graph.edges, edgeDistances, layoutProfile);
    if (seed !== 'fallback') {
        for (let i = 0; i < nodeCount; i++) {
            layoutNodes[i]!.x = positionedNodes[i]!.x;
            layoutNodes[i]!.y = positionedNodes[i]!.y;
        }
    } else if (nodeCount > 0) {
        const display = graph.display;
        const simulation = forceSimulation(layoutNodes)
            .force('charge', forceManyBody<LayoutNode>().strength(layoutProfile.charge))
            .force('link', forceLink<LayoutNode, LayoutLink>(links)
                .id(node => node.id)
                .distance(link => link.distance)
                .strength(layoutProfile.linkStrength))
            .force('collision', forceCollide<LayoutNode>()
                .radius(24 * layoutProfile.collisionMultiplier)
                .strength(1)
                .iterations(4))
            .force('forceX', forceX<LayoutNode>().strength(layoutProfile.forceXYStrength))
            .force('forceY', forceY<LayoutNode>().strength(layoutProfile.forceXYStrength))
            .velocityDecay(layoutProfile.velocityDecay)
            .stop();
        if (display?.d3CenterForce !== false) simulation.force('center', forceCenter());
        const ticks = nodeCount > 1200 ? 160 : 220;
        for (let i = 0; i < ticks; i++) simulation.tick();
    }

    const nodes = new Float32Array(nodeCount * 4);
    const nodeColors = new Float32Array(nodeCount * 4);
    for (let i = 0; i < nodeCount; i++) {
        const node = sourceNodes[i]!;
        const type = node.type;
        if (!typeIndex.has(type)) typeIndex.set(type, typeIndex.size);
        nodes[i * 4] = Number.isFinite(layoutNodes[i]!.x) ? layoutNodes[i]!.x! : 0;
        nodes[i * 4 + 1] = Number.isFinite(layoutNodes[i]!.y) ? layoutNodes[i]!.y! : 0;
        nodes[i * 4 + 2] = typeIndex.get(type)!;
        nodes[i * 4 + 3] = 6;
        nodeColors.set(color(graph.display?.nodeColors, type, [0.45, 0.72, 0.85, 0.95]), i * 4);
    }
    const geographic = seedGeodesicGlobe(positionedNodes, graph.edges, edgeDistances);
    const globe = geographic ? {
        nodes: nodes.slice(), depths: geographic.depths, edgeDistances: geographic.chordDistances,
    } : undefined;
    if (globe) for (let i = 0; i < nodeCount; i++) {
        globe.nodes[i * 4] = positionedNodes[i]!.x!;
        globe.nodes[i * 4 + 1] = positionedNodes[i]!.y!;
    }
    return { id: request.id, nodes, edges, edgeDistances, nodeColors,
        edgeColors: Float32Array.from(edgeColors), edgeWidths: Float32Array.from(edgeWidths),
        arrows: Float32Array.from(arrows), layoutProfile, globe,
        labels, nodeIds, nodeCount, edgeCount: edges.length / 2, layoutMs: performance.now() - started };
}

self.onmessage = (event: MessageEvent<ExampleRequest>) => {
    const result = makeExample(event.data);
    const transfer: Transferable[] = [result.nodes.buffer, result.edges.buffer, result.edgeDistances.buffer,
        result.nodeColors.buffer, result.edgeColors.buffer, result.edgeWidths.buffer, result.arrows.buffer];
    if (result.globe) transfer.push(result.globe.nodes.buffer, result.globe.depths.buffer, result.globe.edgeDistances.buffer);
    self.postMessage(result, { transfer });
};
