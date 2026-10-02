import type { FGLink, FGNode } from './graph-ui-types.js';

export interface GeodesicSeed {
    depths: Float32Array;
    chordDistances: Float32Array;
    radius: number;
}

/**
 * Recognize a dense graph whose link lengths are great-circle arcs between
 * authored latitude/longitude coordinates. Springs in XYZ need chords instead.
 */
export function seedGeodesicGlobe(nodes: FGNode[], links: readonly FGLink[],
    distances: Float32Array): GeodesicSeed | null {
    if (nodes.length < 12 || links.length < nodes.length * 3 || links.length !== distances.length) return null;
    const unit = new Float64Array(nodes.length * 3);
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    for (let i = 0; i < nodes.length; i++) {
        const lat = Number(nodes[i]!.properties?.lat);
        const lon = Number(nodes[i]!.properties?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        const latitude = lat * Math.PI / 180;
        const longitude = lon * Math.PI / 180;
        unit[i * 3] = Math.cos(latitude) * Math.sin(longitude);
        unit[i * 3 + 1] = -Math.sin(latitude);
        unit[i * 3 + 2] = Math.cos(latitude) * Math.cos(longitude);
    }
    const radii: number[] = [];
    const samples = Math.min(links.length, 512);
    for (let sample = 0; sample < samples; sample++) {
        const edge = Math.floor(sample * links.length / samples);
        const source = indexById.get(links[edge]!.source_id);
        const target = indexById.get(links[edge]!.target_id);
        if (source === undefined || target === undefined || source === target) continue;
        const distance = distances[edge]!;
        const dot = unit[source * 3]! * unit[target * 3]! +
            unit[source * 3 + 1]! * unit[target * 3 + 1]! +
            unit[source * 3 + 2]! * unit[target * 3 + 2]!;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle > 0.02 && Number.isFinite(distance) && distance > 0) radii.push(distance / angle);
    }
    if (radii.length < 16) return null;
    radii.sort((a, b) => a - b);
    const radius = radii[Math.floor(radii.length / 2)]!;
    const errors = radii.map(value => Math.abs(value / radius - 1)).sort((a, b) => a - b);
    if (!Number.isFinite(radius) || radius <= 0 || errors[Math.floor(errors.length / 2)]! > 0.03) return null;
    const depths = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
        nodes[i]!.x = radius * unit[i * 3]!;
        nodes[i]!.y = radius * unit[i * 3 + 1]!;
        depths[i] = radius * unit[i * 3 + 2]!;
    }
    // A great-circle arc s subtends s/R radians; the straight 3D spring needs
    // its chord, 2R sin(s / 2R), rather than the longer distance along the shell.
    const chordDistances = Float32Array.from(distances, arc =>
        Number.isFinite(arc) && arc > 0 ? 2 * radius * Math.sin(Math.min(Math.PI, arc / radius) / 2) : arc);
    return { depths, chordDistances, radius };
}
