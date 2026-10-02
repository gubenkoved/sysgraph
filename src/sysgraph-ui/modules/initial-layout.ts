import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
    type SimulationLinkDatum, type SimulationNodeDatum } from 'd3';
import type { LayoutProfile } from '../engine/force-layout.js';
import type { FGLink, FGNode } from './graph-ui-types.js';

interface SeedNode extends SimulationNodeDatum { id: string }
interface SeedLink extends SimulationLinkDatum<SeedNode> { distance: number }

function median(values: number[], fallback: number): number {
    if (!values.length) return fallback;
    values.sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)]!;
}

/** Recognize paired strands by their data, preserving the authored sequence. */
function seedPairedStrands(nodes: FGNode[], links: FGLink[], distances: Float32Array): boolean {
    if (nodes.length < 12 || nodes.length % 2 !== 0) return false;
    const pairs = new Map<number, Map<number, FGNode>>();
    for (const node of nodes) {
        const pair = Number(node.properties?.base_pair);
        const strand = Number(node.properties?.strand);
        if (!Number.isInteger(pair) || !Number.isInteger(strand)) return false;
        let strands = pairs.get(pair);
        if (!strands) { strands = new Map(); pairs.set(pair, strands); }
        if (strands.has(strand)) return false;
        strands.set(strand, node);
    }
    if (pairs.size * 2 !== nodes.length || [...pairs.values()].some(strands => strands.size !== 2)) return false;
    const pairNumbers = [...pairs.keys()].sort((left, right) => left - right);
    const strandNumbers = [...pairs.values()][0]!.keys();
    const strands = [...strandNumbers].sort((left, right) => left - right);
    if ([...pairs.values()].some(pair => !strands.every(strand => pair.has(strand)))) return false;
    const byId = new Map(nodes.map(node => [node.id, node]));
    const rungDistances: number[] = [];
    const stepDistances: number[] = [];
    for (let index = 0; index < links.length; index++) {
        const source = byId.get(links[index]!.source_id);
        const target = byId.get(links[index]!.target_id);
        if (!source || !target) continue;
        const length = distances[index]!;
        if (!Number.isFinite(length) || length <= 0) continue;
        if (source.properties?.base_pair === target.properties?.base_pair) rungDistances.push(length);
        else if (source.properties?.strand === target.properties?.strand &&
            Math.abs(Number(source.properties?.base_pair) - Number(target.properties?.base_pair)) === 1) stepDistances.push(length);
    }
    const pairWidth = Math.max(12, Math.min(200, median(rungDistances, 50)));
    const step = Math.max(8, Math.min(150, median(stepDistances, 24)));
    const total = (pairNumbers.length - 1) * step;
    const leg = total * 0.22;
    const arcLength = total - leg * 2;
    const radius = arcLength / Math.PI;
    const verticalCenter = (leg - radius) / 2;
    for (let index = 0; index < pairNumbers.length; index++) {
        const distance = index * step;
        let centerX: number, centerY: number, normalX: number, normalY: number;
        if (distance < leg) {
            centerX = -radius; centerY = leg - distance; normalX = 1; normalY = 0;
        } else if (distance > leg + arcLength) {
            centerX = radius; centerY = distance - leg - arcLength; normalX = -1; normalY = 0;
        } else {
            const angle = Math.PI - (distance - leg) / radius;
            centerX = radius * Math.cos(angle);
            centerY = -radius * Math.sin(angle);
            normalX = -Math.cos(angle);
            normalY = Math.sin(angle);
        }
        for (let strand = 0; strand < 2; strand++) {
            const node = pairs.get(pairNumbers[index]!)!.get(strands[strand]!)!;
            const side = strand === 0 ? 1 : -1;
            node.x = centerX + normalX * side * pairWidth / 2;
            node.y = centerY - verticalCenter + normalY * side * pairWidth / 2;
        }
    }
    return true;
}

/** Give small authored graphs a settled first frame and preserve explicit grid topology. */
export function seedInitialLayout(nodes: FGNode[], links: FGLink[], distances: Float32Array,
    profile: LayoutProfile): 'existing' | 'grid' | 'paired-strands' | 'force' | 'fallback' {
    if (nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))) return 'existing';
    if (seedPairedStrands(nodes, links, distances)) return 'paired-strands';
    const grid = nodes.length > 0 && nodes.every(node =>
        Number.isFinite(node.properties?.row) && Number.isFinite(node.properties?.col));
    if (grid) {
        let minRow = Infinity, maxRow = -Infinity, minColumn = Infinity, maxColumn = -Infinity;
        for (const node of nodes) {
            const row = Number(node.properties!.row), column = Number(node.properties!.col);
            minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
            minColumn = Math.min(minColumn, column); maxColumn = Math.max(maxColumn, column);
        }
        const minDistance = distances.reduce((minimum, distance) =>
            Number.isFinite(distance) && distance > 0 ? Math.min(minimum, distance) : minimum, Infinity);
        const spacing = Number.isFinite(minDistance) ? Math.max(8, Math.min(200, minDistance)) : 26;
        const centerRow = (minRow + maxRow) / 2;
        const centerColumn = (minColumn + maxColumn) / 2;
        for (let index = 0; index < nodes.length; index++) {
            nodes[index]!.x = (Number(nodes[index]!.properties!.col) - centerColumn) * spacing;
            nodes[index]!.y = (Number(nodes[index]!.properties!.row) - centerRow) * spacing;
        }
        return 'grid';
    }
    if (nodes.length > 128 || !links.length) return 'fallback';

    const seeds: SeedNode[] = nodes.map(node => ({ id: node.id, x: node.x, y: node.y }));
    const index = new Map(nodes.map((node, position) => [node.id, position]));
    const seedLinks: SeedLink[] = [];
    for (let position = 0; position < links.length; position++) {
        const link = links[position]!;
        const source = index.get(link.source_id), target = index.get(link.target_id);
        if (source === undefined || target === undefined) continue;
        seedLinks.push({ source, target, distance: distances[position]! });
    }
    const simulation = forceSimulation(seeds)
        .force('charge', forceManyBody<SeedNode>().strength(Math.min(0, profile.charge)))
        .force('link', forceLink<SeedNode, SeedLink>(seedLinks)
            .distance(link => link.distance).strength(Math.max(0, profile.linkStrength)))
        .force('collision', forceCollide<SeedNode>()
            .radius(24 * Math.max(0, profile.collisionMultiplier)).strength(1).iterations(4))
        .force('forceX', forceX<SeedNode>().strength(Math.max(0, profile.forceXYStrength)))
        .force('forceY', forceY<SeedNode>().strength(Math.max(0, profile.forceXYStrength)))
        .velocityDecay(Math.max(0, Math.min(0.95, profile.velocityDecay)))
        .stop();
    simulation.force('center', forceCenter());
    for (let tick = 0; tick < 220; tick++) simulation.tick();
    for (let position = 0; position < nodes.length; position++) {
        nodes[position]!.x = seeds[position]!.x;
        nodes[position]!.y = seeds[position]!.y;
    }
    return 'force';
}
