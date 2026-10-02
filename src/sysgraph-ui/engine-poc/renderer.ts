import { DEFAULT_LAYOUT_PROFILE, GpuForceLayout, type LayoutProfile } from './force-layout.js';
import { ATLAS_HEIGHT, ATLAS_WIDTH, createLabelAtlas, type LabelAtlas, type LabelFrame, MAX_LABEL_GLYPHS } from './labels.js';
import { MAX_NODE_SCREEN_RADIUS, MIN_NODE_SCREEN_RADIUS } from './node-size.js';
import { createDepths } from './projection.js';

export type EdgeStyle = 'thin' | 'smooth';

export interface CameraState {
    centerX: number;
    centerY: number;
    centerZ?: number;
    scale: number; // physical pixels per world unit
    stroke: number; // physical pixels
    mode3d: boolean;
    yaw: number;
    pitch: number;
    distance: number;
    referenceDistance: number;
    pixelRatio?: number;
}

export interface FrameWork {
    cpuSubmitMs: number;
    layoutEncodeMs: number;
    layoutSteps: number;
    drawCalls: number;
    vertices: number;
    layoutTick: boolean;
    layoutTicks: number;
}

const CLEAR = { r: 0.025, g: 0.052, b: 0.078, a: 1 };

const RADIUS_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> nodes: array<vec4f>;
@group(0) @binding(1) var<storage, read> radii: array<f32>;

@compute @workgroup_size(256)
fn updateRadii(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= arrayLength(&nodes)) { return; }
    let node = nodes[id.x];
    nodes[id.x] = vec4f(node.xyz, select(radii[id.x], -radii[id.x], node.w < 0.0));
}
`;

const SHADER = /* wgsl */ `
struct Camera {
    center: vec2f,
    scale: f32,
    stroke: f32,
    viewport: vec2f,
    focusNode: u32,
    outlineWidth: f32,
    mode3d: u32,
    cosYaw: f32,
    sinYaw: f32,
    cosPitch: f32,
    sinPitch: f32,
    distance: f32,
    referenceDistance: f32,
    pixelRatio: f32,
    centerZ: f32,
    searchTime: f32,
}

@group(0) @binding(0) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(1) var<storage, read> edges: array<vec2u>;
@group(0) @binding(2) var<uniform> camera: Camera;
@group(0) @binding(3) var<storage, read> neighborFlags: array<u32>;
@group(0) @binding(5) var<storage, read> nodeColors: array<vec4f>;
@group(0) @binding(6) var<storage, read> edgeColors: array<vec4f>;
@group(0) @binding(7) var<storage, read> edgeWidths: array<f32>;
@group(0) @binding(8) var<storage, read> arrowLengths: array<f32>;

fn colorFor(cluster: u32) -> vec3f {
    let colors = array<vec3f, 12>(
        vec3f(0.35, 0.84, 0.78), vec3f(0.98, 0.67, 0.43),
        vec3f(0.64, 0.70, 0.98), vec3f(0.87, 0.55, 0.77),
        vec3f(0.53, 0.81, 0.56), vec3f(0.95, 0.78, 0.43),
        vec3f(0.40, 0.76, 0.93), vec3f(0.80, 0.64, 0.96),
        vec3f(0.95, 0.58, 0.56), vec3f(0.53, 0.87, 0.76),
        vec3f(0.73, 0.80, 0.46), vec3f(0.96, 0.73, 0.64)
    );
    return colors[cluster % 12u];
}

struct Projected {
    screen: vec2f,
    depth: f32,
    factor: f32,
}

fn projectNode(index: u32) -> Projected {
    let delta = nodes[index].xy - camera.center;
    if (camera.mode3d == 0u) {
        return Projected(delta * camera.scale + camera.viewport * 0.5, 0.5, 1.0);
    }
    let z = nodes[index].z - camera.centerZ;
    let rotatedX = camera.cosYaw * delta.x - camera.sinYaw * z;
    let rotatedZ = camera.sinYaw * delta.x + camera.cosYaw * z;
    let rotatedY = camera.cosPitch * delta.y - camera.sinPitch * rotatedZ;
    let viewZ = camera.sinPitch * delta.y + camera.cosPitch * rotatedZ;
    let eyeDistance = max(camera.distance - viewZ, camera.referenceDistance * 0.05);
    let factor = camera.referenceDistance / eyeDistance;
    let screen = vec2f(rotatedX, rotatedY) * camera.scale * factor + camera.viewport * 0.5;
    let normalizedDepth = clamp(1.0 - camera.referenceDistance * 0.05 / eyeDistance, 0.0, 1.0);
    return Projected(screen, normalizedDepth, factor);
}

fn nodeScreenRadius(index: u32, perspectiveFactor: f32) -> f32 {
    return clamp(abs(nodes[index].w) * camera.scale * perspectiveFactor,
        ${MIN_NODE_SCREEN_RADIUS} * camera.pixelRatio, ${MAX_NODE_SCREEN_RADIUS} * camera.pixelRatio);
}

fn clipPosition(screen: vec2f, depth: f32) -> vec4f {
    return vec4f(screen.x / camera.viewport.x * 2.0 - 1.0,
                 1.0 - screen.y / camera.viewport.y * 2.0, depth, 1.0);
}

fn edgeFocusTier(endpoints: vec2u) -> u32 {
    if (endpoints.x == camera.focusNode || endpoints.y == camera.focusNode) { return 1u; }
    if ((neighborFlags[endpoints.x] & 3u) == 2u || (neighborFlags[endpoints.y] & 3u) == 2u) { return 2u; }
    return 3u;
}

fn edgeFocusAlpha(tier: u32) -> f32 {
    if (tier == 1u) { return 1.5; }
    if (tier == 2u) { return 0.5; }
    return 0.1;
}

struct LineVertex {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) @interpolate(flat) focusTier: u32,
}

@vertex fn lineVertex(@builtin(vertex_index) vertex: u32) -> LineVertex {
    let endpoints = edges[vertex / 2u];
    let index = select(endpoints.x, endpoints.y, (vertex & 1u) == 1u);
    var out: LineVertex;
    let projected = projectNode(index);
    out.position = clipPosition(projected.screen, projected.depth);
    out.color = edgeColors[vertex / 2u];
    out.focusTier = edgeFocusTier(endpoints);
    return out;
}

@fragment fn lineFragment(in: LineVertex) -> @location(0) vec4f {
    if (camera.focusNode == 0xffffffffu) { return in.color; }
    return vec4f(in.color.rgb, min(1.0, in.color.a * edgeFocusAlpha(in.focusTier)));
}

struct SmoothVertex {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) signedDistance: f32,
    @location(2) @interpolate(flat) focusTier: u32,
    @location(3) halfWidth: f32,
}

@vertex fn smoothVertex(
    @builtin(vertex_index) vertex: u32,
    @builtin(instance_index) instance: u32
) -> SmoothVertex {
    let endpoints = edges[instance];
    let projectedA = projectNode(endpoints.x);
    let projectedB = projectNode(endpoints.y);
    let a = projectedA.screen;
    let b = projectedB.screen;
    let direction = b - a;
    let normal = vec2f(-direction.y, direction.x) / max(length(direction), 0.001);
    let atEnd = vertex == 1u || vertex == 4u || vertex == 5u;
    let positive = vertex == 2u || vertex == 3u || vertex == 5u;
    let side = select(-1.0, 1.0, positive);
    let halfWidth = max(camera.stroke * edgeWidths[instance] * 0.5, 0.5);
    let outer = halfWidth + 1.0;
    let point = select(a, b, atEnd) + normal * side * outer;
    var out: SmoothVertex;
    out.position = clipPosition(point, select(projectedA.depth, projectedB.depth, atEnd));
    out.color = edgeColors[instance];
    out.signedDistance = side * outer;
    out.focusTier = edgeFocusTier(endpoints);
    out.halfWidth = halfWidth;
    return out;
}

@fragment fn smoothFragment(in: SmoothVertex) -> @location(0) vec4f {
    let halfWidth = in.halfWidth;
    let coverage = 1.0 - smoothstep(halfWidth - 0.7, halfWidth + 0.7, abs(in.signedDistance));
    if (camera.focusNode == 0xffffffffu) { return vec4f(in.color.rgb, coverage * in.color.a); }
    return vec4f(in.color.rgb, coverage * min(1.0, in.color.a * edgeFocusAlpha(in.focusTier)));
}

struct ArrowVertex {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) @interpolate(flat) focusTier: u32,
    @location(2) local: vec2f,
    @location(3) @interpolate(flat) size: vec2f,
}

@vertex fn arrowVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> ArrowVertex {
    let endpoints = edges[instance];
    let source = projectNode(endpoints.x);
    let destination = projectNode(endpoints.y);
    let delta = destination.screen - source.screen;
    let distance = length(delta);
    let lengthPx = clamp(arrowLengths[instance] * 1.3, 5.0, 20.0) * camera.pixelRatio;
    let sourceRadius = nodeScreenRadius(endpoints.x, source.factor);
    let targetRadius = nodeScreenRadius(endpoints.y, destination.factor);
    var out: ArrowVertex;
    if (arrowLengths[instance] <= 0.0 || distance < sourceRadius + targetRadius + lengthPx + 4.0) {
        out.position = vec4f(2.0, 2.0, 0.0, 1.0);
        out.color = vec4f(0.0);
        out.focusTier = 3u;
        out.local = vec2f(0.0);
        out.size = vec2f(1.0);
        return out;
    }
    let direction = delta / distance;
    let normal = vec2f(-direction.y, direction.x);
    let t = clamp(0.55, (sourceRadius + lengthPx * 0.5 + 2.0) / distance,
                         1.0 - (targetRadius + lengthPx * 0.5 + 2.0) / distance);
    let center = mix(source.screen, destination.screen, t);
    let halfWidth = clamp(lengthPx * 0.38, 2.5 * camera.pixelRatio, 8.0 * camera.pixelRatio);
    let axial = select(-lengthPx * 0.5, lengthPx * 0.5, vertex == 0u);
    let lateral = select(0.0, select(halfWidth, -halfWidth, vertex == 2u), vertex != 0u);
    out.position = clipPosition(center + direction * axial + normal * lateral,
                                mix(source.depth, destination.depth, t));
    out.color = edgeColors[instance];
    out.focusTier = edgeFocusTier(endpoints);
    out.local = vec2f(axial + lengthPx * 0.5, lateral);
    out.size = vec2f(lengthPx, halfWidth);
    return out;
}

@vertex fn loopArrowVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> ArrowVertex {
    let index = edges[instance].x;
    let projected = projectNode(index);
    let radius = nodeScreenRadius(index, projected.factor) + 9.0 * camera.pixelRatio;
    let angle = 3.455751918;
    let radial = vec2f(cos(angle), sin(angle));
    let tangent = vec2f(-radial.y, radial.x);
    let center = projected.screen + vec2f(radius, -radius) + radial * radius;
    let lengthPx = clamp(arrowLengths[instance] * 1.3, 5.0, 20.0) * camera.pixelRatio;
    let halfWidth = clamp(lengthPx * 0.38, 2.5 * camera.pixelRatio, 8.0 * camera.pixelRatio);
    let axial = select(-lengthPx * 0.5, lengthPx * 0.5, vertex == 0u);
    let lateral = select(0.0, select(halfWidth, -halfWidth, vertex == 2u), vertex != 0u);
    var out: ArrowVertex;
    out.position = clipPosition(center + tangent * axial + radial * lateral, projected.depth);
    if (arrowLengths[instance] <= 0.0) { out.position = vec4f(2.0, 2.0, 0.0, 1.0); }
    out.color = edgeColors[instance];
    out.focusTier = edgeFocusTier(edges[instance]);
    out.local = vec2f(axial + lengthPx * 0.5, lateral);
    out.size = vec2f(lengthPx, halfWidth);
    return out;
}

@fragment fn arrowFragment(in: ArrowVertex) -> @location(0) vec4f {
    let axial = in.local.x;
    let edge = (1.0 - axial / in.size.x) * in.size.y - abs(in.local.y);
    let coverage = smoothstep(0.0, 1.0, min(min(axial, in.size.x - axial), edge));
    var alpha = in.color.a * coverage;
    if (camera.focusNode != 0xffffffffu) {
        alpha *= edgeFocusAlpha(in.focusTier);
    }
    return vec4f(in.color.rgb, min(1.0, alpha));
}

@vertex fn loopVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> SmoothVertex {
    let endpoints = edges[instance];
    let projected = projectNode(endpoints.x);
    let segment = vertex / 6u;
    let corner = vertex % 6u;
    let atEnd = corner == 1u || corner == 4u || corner == 5u;
    let positive = corner == 2u || corner == 3u || corner == 5u;
    let angle = (f32(segment) + select(0.0, 1.0, atEnd)) * 6.283185307 / 24.0;
    let radius = nodeScreenRadius(endpoints.x, projected.factor) + 9.0 * camera.pixelRatio;
    let offset = vec2f(radius, -radius) + vec2f(cos(angle), sin(angle)) * radius;
    let halfWidth = max(camera.stroke * edgeWidths[instance] * 0.5, 0.5);
    let outer = halfWidth + 1.0;
    let side = select(-1.0, 1.0, positive);
    var out: SmoothVertex;
    out.position = clipPosition(projected.screen + offset + vec2f(cos(angle), sin(angle)) * side * outer, projected.depth);
    out.color = edgeColors[instance];
    out.signedDistance = side * outer;
    out.focusTier = edgeFocusTier(endpoints);
    out.halfWidth = halfWidth;
    return out;
}

struct NodeVertex {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) offset: vec2f,
    @location(2) radius: f32,
    @location(3) @interpolate(flat) flag: u32,
    @location(4) @interpolate(flat) pinned: u32,
    @location(5) @interpolate(flat) selected: u32,
    @location(6) @interpolate(flat) searchStatus: u32,
}

@vertex fn nodeVertex(
    @builtin(vertex_index) vertex: u32,
    @builtin(instance_index) instance: u32
) -> NodeVertex {
    let node = nodes[instance];
    let projected = projectNode(instance);
    let flag = neighborFlags[instance] & 3u;
    let searchStatus = (neighborFlags[instance] >> 2u) & 3u;
    let pinned = select(0u, 1u, node.w < 0.0);
    let baseRadius = nodeScreenRadius(instance, projected.factor);
    let radius = select(baseRadius, max(baseRadius, 5.0 * camera.pixelRatio), pinned == 1u)
        + select(0.0, 1.25 * camera.pixelRatio, searchStatus > 0u)
        + select(0.0, 1.75 * camera.pixelRatio, searchStatus == 2u)
        + select(0.0, 3.0, camera.focusNode != 0xffffffffu && flag == 3u);
    let selected = select(0u, 1u, nodeColors[instance].a < 0.0);
    let outer = radius + camera.outlineWidth + select(1.2, 4.0, selected == 1u)
        + select(0.0, select(6.0, 16.0, searchStatus == 2u) * camera.pixelRatio, searchStatus > 0u);
    let x = select(-1.0, 1.0, vertex == 1u || vertex == 4u || vertex == 5u);
    let y = select(-1.0, 1.0, vertex == 2u || vertex == 3u || vertex == 5u);
    let offset = vec2f(x, y) * outer;
    var out: NodeVertex;
    out.position = clipPosition(projected.screen + offset, projected.depth);
    out.color = nodeColors[instance];
    out.offset = offset;
    out.radius = radius;
    out.flag = flag;
    out.pinned = pinned;
    out.selected = selected;
    out.searchStatus = searchStatus;
    return out;
}

@fragment fn nodeFragment(in: NodeVertex) -> @location(0) vec4f {
    let distance = length(in.offset);
    let body = 1.0 - smoothstep(in.radius - 0.8, in.radius + 0.8, distance);
    var bodyColor = in.color.rgb;
    var opacity = abs(in.color.a);
    if (camera.focusNode != 0xffffffffu) {
        if (in.flag == 3u) {
            bodyColor = mix(in.color.rgb, vec3f(1.0), 0.3);
            opacity = abs(in.color.a);
        } else if (in.flag == 2u) {
            opacity = abs(in.color.a);
        } else if (in.flag == 1u) {
            opacity = abs(in.color.a) * 0.5;
        } else {
            opacity = abs(in.color.a) * 0.1;
        }
    }
    if (in.searchStatus == 1u) { opacity = max(opacity, abs(in.color.a) * 0.65); }
    if (in.searchStatus == 2u) { opacity = abs(in.color.a); }
    var alpha = body * opacity;
    var color = bodyColor;
    if (camera.outlineWidth > 0.0) {
        let outer = 1.0 - smoothstep(in.radius + camera.outlineWidth - 0.8,
                                      in.radius + camera.outlineWidth + 0.8, distance);
        let ring = max(0.0, outer - body);
        let ringOpacity = opacity * 0.85;
        let combined = alpha + ring * ringOpacity;
        let outlineColor = mix(in.color.rgb, vec3f(1.0), 0.58);
        color = (bodyColor * alpha + outlineColor * ring * ringOpacity) / max(combined, 0.0001);
        alpha = combined;
    }
    if (in.selected == 1u) {
        let outer = 1.0 - smoothstep(in.radius + camera.outlineWidth + 2.2,
                                      in.radius + camera.outlineWidth + 3.2, distance);
        let inner = 1.0 - smoothstep(in.radius + camera.outlineWidth + 0.5,
                                      in.radius + camera.outlineWidth + 1.2, distance);
        let ring = max(0.0, outer - inner);
        let combined = alpha + ring * (1.0 - alpha);
        color = (color * alpha + vec3f(0.96, 0.23, 0.24) * ring * (1.0 - alpha)) / max(combined, 0.0001);
        alpha = combined;
    }
    if (in.searchStatus > 0u) {
        let current = in.searchStatus == 2u;
        let base = in.radius + camera.outlineWidth;
        let px = camera.pixelRatio;
        let aa = 0.7 * px;
        let inner = base + select(1.7, 2.2, current) * px;
        let outer = base + select(4.1, 5.8, current) * px;
        let ring = smoothstep(inner - aa, inner + aa, distance)
            * (1.0 - smoothstep(outer - aa, outer + aa, distance));
        let glow = smoothstep(outer - aa, outer + aa, distance)
            * (1.0 - smoothstep(outer + 2.0 * px, outer + 3.5 * px, distance));
        let accent = select(vec3f(1.0, 0.50, 0.08), vec3f(1.0, 0.16, 0.22), current);
        let accentAlpha = (ring * select(0.90, 1.0, current) + glow * select(0.13, 0.24, current)) * opacity;
        let combined = alpha + accentAlpha * (1.0 - alpha);
        color = (color * alpha + accent * accentAlpha * (1.0 - alpha)) / max(combined, 0.0001);
        alpha = combined;
        if (current && camera.searchTime >= 0.0) {
            let phase = fract(camera.searchTime / 1.7);
            let pulseRadius = base + (8.0 + 6.0 * phase) * px;
            let pulse = smoothstep(pulseRadius - 1.7 * px, pulseRadius - 0.7 * px, distance)
                * (1.0 - smoothstep(pulseRadius + 0.7 * px, pulseRadius + 1.7 * px, distance));
            let pulseAlpha = pulse * (1.0 - phase) * 0.50 * opacity;
            let pulseCombined = alpha + pulseAlpha * (1.0 - alpha);
            color = (color * alpha + accent * pulseAlpha * (1.0 - alpha)) / max(pulseCombined, 0.0001);
            alpha = pulseCombined;
        }
    }
    if (in.pinned == 1u) {
        let dot = (1.0 - smoothstep(1.4, 2.2, distance)) * opacity;
        let combined = dot + alpha * (1.0 - dot);
        color = (vec3f(0.025, 0.052, 0.078) * dot + color * alpha * (1.0 - dot)) / max(combined, 0.0001);
        alpha = combined;
    }
    if (alpha < 0.001) { discard; }
    return vec4f(color, alpha);
}
`;

const LABEL_SHADER = /* wgsl */ `
struct Camera {
    center: vec2f,
    scale: f32,
    stroke: f32,
    viewport: vec2f,
    focusNode: u32,
    outlineWidth: f32,
    mode3d: u32,
    cosYaw: f32,
    sinYaw: f32,
    cosPitch: f32,
    sinPitch: f32,
    distance: f32,
    referenceDistance: f32,
    pixelRatio: f32,
    centerZ: f32,
    searchTime: f32,
}

struct Glyph {
    rect: vec4f,
    uv: vec4f,
    node: u32,
    opacity: f32,
    pad1: u32,
    pad2: u32,
}

@group(0) @binding(2) var<uniform> camera: Camera;
@group(0) @binding(0) var<storage, read> nodes: array<vec4f>;
@group(1) @binding(0) var<storage, read> glyphs: array<Glyph>;
@group(1) @binding(1) var labelAtlas: texture_2d<f32>;
@group(1) @binding(2) var atlasSampler: sampler;

struct LabelVertex {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) opacity: f32,
}

@vertex fn labelVertex(
    @builtin(vertex_index) vertex: u32,
    @builtin(instance_index) instance: u32
) -> LabelVertex {
    let glyph = glyphs[instance];
    let x = select(0.0, 1.0, vertex == 1u || vertex == 4u || vertex == 5u);
    let y = select(0.0, 1.0, vertex == 2u || vertex == 3u || vertex == 5u);
    let delta = nodes[glyph.node].xy - camera.center;
    var anchor = delta * camera.scale + camera.viewport * 0.5;
    if (camera.mode3d == 1u) {
        let z = nodes[glyph.node].z - camera.centerZ;
        let rotatedX = camera.cosYaw * delta.x - camera.sinYaw * z;
        let rotatedZ = camera.sinYaw * delta.x + camera.cosYaw * z;
        let rotatedY = camera.cosPitch * delta.y - camera.sinPitch * rotatedZ;
        let viewZ = camera.sinPitch * delta.y + camera.cosPitch * rotatedZ;
        let factor = camera.referenceDistance / max(camera.distance - viewZ, camera.referenceDistance * 0.05);
        anchor = vec2f(rotatedX, rotatedY) * camera.scale * factor + camera.viewport * 0.5;
    }
    let screen = anchor + glyph.rect.xy + vec2f(x, y) * glyph.rect.zw;
    var out: LabelVertex;
    out.position = vec4f(screen.x / camera.viewport.x * 2.0 - 1.0,
                         1.0 - screen.y / camera.viewport.y * 2.0, 0.0, 1.0);
    out.uv = mix(glyph.uv.xy, glyph.uv.zw, vec2f(x, y));
    out.opacity = glyph.opacity;
    return out;
}

@fragment fn labelFragment(in: LabelVertex) -> @location(0) vec4f {
    let glyph = textureSample(labelAtlas, atlasSampler, in.uv);
    return vec4f(glyph.rgb, glyph.a * in.opacity);
}
`;

interface GraphBuffers {
    nodes: [GPUBuffer, GPUBuffer];
    radii: GPUBuffer;
    radiusBindGroups: [GPUBindGroup, GPUBindGroup];
    edges: GPUBuffer;
    highlight: GPUBuffer;
    nodeColors: GPUBuffer;
    edgeColors: GPUBuffer;
    edgeWidths: GPUBuffer;
    arrowLengths: GPUBuffer;
    nodeColorData: Float32Array;
    selected: Uint8Array;
    pinData: Float32Array;
    pinIndices: Set<number>;
    flags: Uint32Array;
    searchMask: Uint8Array;
    activeSearch: number | null;
    bindGroups: [GPUBindGroup, GPUBindGroup];
    labelFrameBindGroups: [GPUBindGroup, GPUBindGroup];
    layout: GpuForceLayout | null;
    initialNodes: Float32Array;
    initialEdges: Uint32Array;
    edgeDistances?: Float32Array;
    layoutProfile: LayoutProfile;
    layoutDimensions: 2 | 3;
    activeIndex: number;
    nodeCount: number;
    edgeCount: number;
    arrowCount: number;
    loopArrowCount: number;
    loopStart: number;
    edgeOrder: Uint32Array;
    foregroundEdges: Uint32Array;
    bytes: number;
}

export class WebGPUGraphRenderer {
    private readonly device: GPUDevice;
    private readonly context: GPUCanvasContext;
    private readonly bindGroupLayout: GPUBindGroupLayout;
    private readonly labelFrameBindGroupLayout: GPUBindGroupLayout;
    private readonly cameraBuffer: GPUBuffer;
    private readonly radiusPipeline: GPUComputePipeline;
    private readonly cameraData = new Float32Array(20);
    private readonly cameraWords = new Uint32Array(this.cameraData.buffer);
    private readonly linePipeline: GPURenderPipeline;
    private readonly linePipeline2D: GPURenderPipeline;
    private readonly smoothPipeline: GPURenderPipeline;
    private readonly smoothPipeline2D: GPURenderPipeline;
    private readonly loopPipeline: GPURenderPipeline;
    private readonly loopPipeline2D: GPURenderPipeline;
    private readonly arrowPipeline: GPURenderPipeline;
    private readonly arrowPipeline2D: GPURenderPipeline;
    private readonly loopArrowPipeline: GPURenderPipeline;
    private readonly loopArrowPipeline2D: GPURenderPipeline;
    private readonly nodePipeline: GPURenderPipeline;
    private readonly nodePipeline2D: GPURenderPipeline;
    private readonly labelPipeline: GPURenderPipeline;
    private readonly labelPipeline2D: GPURenderPipeline;
    private readonly labelBuffer: GPUBuffer;
    private readonly labelAtlas: GPUTexture;
    private readonly labelBindGroup: GPUBindGroup;
    private graph: GraphBuffers | null = null;
    private focusNode: number | null = null;
    private snapshotPending = false;
    private depthTexture: GPUTexture | null = null;
    private depthWidth = 0;
    private depthHeight = 0;
    private background: GPUColor = CLEAR;
    readonly adapterName: string;

    private constructor(
        device: GPUDevice,
        context: GPUCanvasContext,
        bindGroupLayout: GPUBindGroupLayout,
        labelFrameBindGroupLayout: GPUBindGroupLayout,
        cameraBuffer: GPUBuffer,
        radiusPipeline: GPUComputePipeline,
        linePipeline: GPURenderPipeline,
        linePipeline2D: GPURenderPipeline,
        smoothPipeline: GPURenderPipeline,
        smoothPipeline2D: GPURenderPipeline,
        loopPipeline: GPURenderPipeline,
        loopPipeline2D: GPURenderPipeline,
        arrowPipeline: GPURenderPipeline,
        arrowPipeline2D: GPURenderPipeline,
        loopArrowPipeline: GPURenderPipeline,
        loopArrowPipeline2D: GPURenderPipeline,
        nodePipeline: GPURenderPipeline,
        nodePipeline2D: GPURenderPipeline,
        labelPipeline: GPURenderPipeline,
        labelPipeline2D: GPURenderPipeline,
        labelBuffer: GPUBuffer,
        labelAtlas: GPUTexture,
        labelBindGroup: GPUBindGroup,
        adapterName: string,
    ) {
        this.device = device;
        this.context = context;
        this.bindGroupLayout = bindGroupLayout;
        this.labelFrameBindGroupLayout = labelFrameBindGroupLayout;
        this.cameraBuffer = cameraBuffer;
        this.radiusPipeline = radiusPipeline;
        this.linePipeline = linePipeline;
        this.linePipeline2D = linePipeline2D;
        this.smoothPipeline = smoothPipeline;
        this.smoothPipeline2D = smoothPipeline2D;
        this.loopPipeline = loopPipeline;
        this.loopPipeline2D = loopPipeline2D;
        this.arrowPipeline = arrowPipeline;
        this.arrowPipeline2D = arrowPipeline2D;
        this.loopArrowPipeline = loopArrowPipeline;
        this.loopArrowPipeline2D = loopArrowPipeline2D;
        this.nodePipeline = nodePipeline;
        this.nodePipeline2D = nodePipeline2D;
        this.labelPipeline = labelPipeline;
        this.labelPipeline2D = labelPipeline2D;
        this.labelBuffer = labelBuffer;
        this.labelAtlas = labelAtlas;
        this.labelBindGroup = labelBindGroup;
        this.adapterName = adapterName;
    }

    static async create(canvas: HTMLCanvasElement, onDeviceLost: (message: string) => void): Promise<WebGPUGraphRenderer> {
        if (!navigator.gpu) throw new Error('WebGPU is unavailable in this browser.');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
            ?? await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter is available on this device.');
        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
        if (!context) throw new Error('Could not create a WebGPU canvas context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        device.lost.then(info => onDeviceLost(`WebGPU device lost: ${info.message || info.reason}`));
        device.addEventListener('uncapturederror', event => onDeviceLost(`WebGPU error: ${event.error.message}`));

        const module = device.createShaderModule({ code: SHADER });
        const diagnostics = await module.getCompilationInfo();
        const errors = diagnostics.messages.filter(message => message.type === 'error');
        if (errors.length) throw new Error(`WGSL compilation failed: ${errors.map(error => error.message).join('; ')}`);

        const radiusModule = device.createShaderModule({ code: RADIUS_SHADER });
        const radiusDiagnostics = await radiusModule.getCompilationInfo();
        const radiusErrors = radiusDiagnostics.messages.filter(message => message.type === 'error');
        if (radiusErrors.length) throw new Error(`Radius WGSL compilation failed: ${radiusErrors.map(error => error.message).join('; ')}`);
        const radiusPipeline = await device.createComputePipelineAsync({
            layout: 'auto', compute: { module: radiusModule, entryPoint: 'updateRadii' },
        });

        const bindGroupLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 8, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ] });
        const labelFrameBindGroupLayout = device.createBindGroupLayout({
            label: 'label camera and nodes',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            ],
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        const blend: GPUBlendState = {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };
        const edgeDepth = { format: 'depth24plus' as GPUTextureFormat, depthWriteEnabled: false, depthCompare: 'less-equal' as GPUCompareFunction };
        const linePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'lineVertex' },
            fragment: { module, entryPoint: 'lineFragment', targets: [{ format, blend }] },
            primitive: { topology: 'line-list' },
            depthStencil: edgeDepth,
        });
        const linePipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'lineVertex' },
            fragment: { module, entryPoint: 'lineFragment', targets: [{ format, blend }] },
            primitive: { topology: 'line-list' },
        });
        const smoothPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'smoothVertex' },
            fragment: { module, entryPoint: 'smoothFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepth,
        });
        const smoothPipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'smoothVertex' },
            fragment: { module, entryPoint: 'smoothFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const loopPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'loopVertex' },
            fragment: { module, entryPoint: 'smoothFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepth,
        });
        const loopPipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'loopVertex' },
            fragment: { module, entryPoint: 'smoothFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const arrowPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'arrowVertex' },
            fragment: { module, entryPoint: 'arrowFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepth,
        });
        const arrowPipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'arrowVertex' },
            fragment: { module, entryPoint: 'arrowFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const loopArrowPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'loopArrowVertex' },
            fragment: { module, entryPoint: 'arrowFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepth,
        });
        const loopArrowPipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'loopArrowVertex' },
            fragment: { module, entryPoint: 'arrowFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const nodePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'nodeFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        });
        const nodePipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'nodeFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const labelModule = device.createShaderModule({ code: LABEL_SHADER });
        const labelDiagnostics = await labelModule.getCompilationInfo();
        const labelErrors = labelDiagnostics.messages.filter(message => message.type === 'error');
        if (labelErrors.length) throw new Error(`Label WGSL compilation failed: ${labelErrors.map(error => error.message).join('; ')}`);
        const labelBuffer = device.createBuffer({
            size: MAX_LABEL_GLYPHS * 48,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'visible label glyphs',
        });
        const atlas = createLabelAtlas();
        const labelAtlas = device.createTexture({
            size: [ATLAS_WIDTH, ATLAS_HEIGHT],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            label: 'label glyph atlas',
        });
        device.queue.copyExternalImageToTexture(
            { source: atlas.canvas },
            { texture: labelAtlas, premultipliedAlpha: false },
            [ATLAS_WIDTH, ATLAS_HEIGHT],
        );
        const labelBindGroupLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ] });
        const labelBindGroup = device.createBindGroup({ layout: labelBindGroupLayout, entries: [
            { binding: 0, resource: { buffer: labelBuffer } },
            { binding: 1, resource: labelAtlas.createView() },
            { binding: 2, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
        ] });
        const labelPipeline = await device.createRenderPipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [labelFrameBindGroupLayout, labelBindGroupLayout] }),
            vertex: { module: labelModule, entryPoint: 'labelVertex' },
            fragment: { module: labelModule, entryPoint: 'labelFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        });
        const labelPipeline2D = await device.createRenderPipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [labelFrameBindGroupLayout, labelBindGroupLayout] }),
            vertex: { module: labelModule, entryPoint: 'labelVertex' },
            fragment: { module: labelModule, entryPoint: 'labelFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const cameraBuffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const info = adapter.info;
        const adapterName = [info.vendor, info.architecture, info.device].filter(Boolean).join(' · ') || info.description || 'WebGPU adapter';
        return new WebGPUGraphRenderer(
            device, context, bindGroupLayout, labelFrameBindGroupLayout, cameraBuffer, radiusPipeline,
            linePipeline, linePipeline2D, smoothPipeline, smoothPipeline2D, loopPipeline, loopPipeline2D,
            arrowPipeline, arrowPipeline2D,
            loopArrowPipeline, loopArrowPipeline2D,
            nodePipeline, nodePipeline2D,
            labelPipeline, labelPipeline2D, labelBuffer, labelAtlas, labelBindGroup, adapterName,
        );
    }

    setGraph(nodes: Float32Array, edges: Uint32Array, edgeDistances?: Float32Array, graphDepths?: Float32Array,
        colors?: { nodes?: Float32Array; edges?: Float32Array; widths?: Float32Array; arrows?: Float32Array },
        layoutProfile: LayoutProfile = DEFAULT_LAYOUT_PROFILE, layoutDimensions: 2 | 3 = 2): void {
        const nodeCount = nodes.length / 4;
        const edgeCount = edges.length / 2;
        if (edgeDistances && edgeDistances.length !== edgeCount) throw new Error('Edge distance count does not match the graph.');
        const order: number[] = [];
        const loops: number[] = [];
        for (let i = 0; i < edgeCount; i++) {
            (edges[i * 2] === edges[i * 2 + 1] ? loops : order).push(i);
        }
        const loopStart = order.length;
        for (const index of loops) order.push(index);
        const edgeOrder = Uint32Array.from(order);
        const sortedEdges = new Uint32Array(edges.length);
        for (let i = 0; i < edgeCount; i++) {
            sortedEdges[i * 2] = edges[edgeOrder[i]! * 2]!;
            sortedEdges[i * 2 + 1] = edges[edgeOrder[i]! * 2 + 1]!;
        }
        const sortedDistances = edgeDistances && Float32Array.from(edgeOrder, index => edgeDistances[index]!);
        const depthData = graphDepths ?? createDepths(nodes);
        if (depthData.length !== nodeCount) throw new Error('Node depth count does not match the graph.');
        if ((colors?.nodes && colors.nodes.length !== nodeCount * 4) ||
            (colors?.edges && colors.edges.length !== edgeCount * 4)) {
            throw new Error('Graph color count does not match the graph.');
        }
        if (colors?.widths && colors.widths.length !== edgeCount) throw new Error('Edge width count does not match the graph.');
        if (colors?.arrows && colors.arrows.length !== edgeCount) throw new Error('Arrow count does not match the graph.');
        if (nodes.byteLength > this.device.limits.maxStorageBufferBindingSize ||
            sortedEdges.byteLength > this.device.limits.maxStorageBufferBindingSize) {
            throw new Error('This graph exceeds the adapter storage-buffer limit.');
        }
        const nodeBuffer = this.device.createBuffer({
            size: Math.max(16, nodes.byteLength),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            label: 'graph nodes A',
        });
        const alternateNodes = this.device.createBuffer({
            size: Math.max(16, nodes.byteLength),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            label: 'graph nodes B',
        });
        const radiusBuffer = this.device.createBuffer({
            size: Math.max(16, nodeCount * 4),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'node radius updates',
        });
        const edgeBuffer = this.device.createBuffer({
            size: Math.max(16, sortedEdges.byteLength),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'static graph edges',
        });
        const flags = new Uint32Array(nodeCount);
        const highlightBuffer = this.device.createBuffer({
            size: Math.max(16, flags.byteLength),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'hover neighborhood mask',
        });
        const nodeColorBuffer = this.device.createBuffer({
            size: Math.max(16, nodeCount * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'node colors',
        });
        const edgeColorBuffer = this.device.createBuffer({
            size: Math.max(16, edgeCount * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'edge colors',
        });
        const edgeWidthBuffer = this.device.createBuffer({
            size: Math.max(16, edgeCount * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'edge widths',
        });
        const arrowBuffer = this.device.createBuffer({
            size: Math.max(16, edgeCount * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'edge arrow lengths',
        });
        const pinData = new Float32Array(nodeCount * 3);
        const spatialNodes = nodes.slice();
        for (let i = 0; i < nodeCount; i++) spatialNodes[i * 4 + 2] = depthData[i]!;
        if (nodes.length) {
            this.device.queue.writeBuffer(nodeBuffer, 0, spatialNodes);
            this.device.queue.writeBuffer(alternateNodes, 0, spatialNodes);
        }
        if (sortedEdges.length) this.device.queue.writeBuffer(edgeBuffer, 0, sortedEdges);
        if (flags.length) this.device.queue.writeBuffer(highlightBuffer, 0, flags);
        const defaultNodeColors = new Float32Array(nodeCount * 4);
        const defaultEdgeColors = new Float32Array(edgeCount * 4);
        if (!colors) {
            const palette = [0.35, 0.84, 0.78, 0.98, 0.67, 0.43, 0.64, 0.70, 0.98, 0.87, 0.55, 0.77,
                0.53, 0.81, 0.56, 0.95, 0.78, 0.43, 0.40, 0.76, 0.93, 0.80, 0.64, 0.96,
                0.95, 0.58, 0.56, 0.53, 0.87, 0.76, 0.73, 0.80, 0.46, 0.96, 0.73, 0.64];
            for (let i = 0; i < nodeCount; i++) {
                const cluster = (Math.max(0, Math.floor(nodes[i * 4 + 2]!)) % 12) * 3;
                defaultNodeColors.set([palette[cluster]!, palette[cluster + 1]!, palette[cluster + 2]!, 0.95], i * 4);
            }
            for (let i = 0; i < edgeCount; i++) {
                const source = sortedEdges[i * 2]!;
                defaultEdgeColors.set([defaultNodeColors[source * 4]!, defaultNodeColors[source * 4 + 1]!,
                    defaultNodeColors[source * 4 + 2]!, 0.19], i * 4);
            }
        }
        const nodeColorData = (colors?.nodes ?? defaultNodeColors).slice();
        if (nodeCount) this.device.queue.writeBuffer(nodeColorBuffer, 0, nodeColorData);
        const sortedColors = new Float32Array(edgeCount * 4);
        const sortedWidths = new Float32Array(edgeCount);
        const sortedArrows = new Float32Array(edgeCount);
        for (let i = 0; i < edgeCount; i++) {
            sortedColors.set((colors?.edges ?? defaultEdgeColors).subarray(edgeOrder[i]! * 4, edgeOrder[i]! * 4 + 4), i * 4);
            sortedWidths[i] = colors?.widths?.[edgeOrder[i]!] ?? 1;
            sortedArrows[i] = colors?.arrows?.[edgeOrder[i]!] ?? 0;
        }
        if (edgeCount) this.device.queue.writeBuffer(edgeColorBuffer, 0, sortedColors);
        if (edgeCount) this.device.queue.writeBuffer(edgeWidthBuffer, 0, sortedWidths);
        if (edgeCount) this.device.queue.writeBuffer(arrowBuffer, 0, sortedArrows);
        const bindGroups = [nodeBuffer, alternateNodes].map(buffer => this.device.createBindGroup({ layout: this.bindGroupLayout, entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: { buffer: edgeBuffer } },
            { binding: 2, resource: { buffer: this.cameraBuffer } },
            { binding: 3, resource: { buffer: highlightBuffer } },
            { binding: 5, resource: { buffer: nodeColorBuffer } },
            { binding: 6, resource: { buffer: edgeColorBuffer } },
            { binding: 7, resource: { buffer: edgeWidthBuffer } },
            { binding: 8, resource: { buffer: arrowBuffer } },
        ] })) as [GPUBindGroup, GPUBindGroup];
        const radiusBindGroups = [nodeBuffer, alternateNodes].map(buffer => this.device.createBindGroup({
            layout: this.radiusPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer } },
                { binding: 1, resource: { buffer: radiusBuffer } },
            ],
        })) as [GPUBindGroup, GPUBindGroup];
        const labelFrameBindGroups = [nodeBuffer, alternateNodes].map(buffer => this.device.createBindGroup({
            layout: this.labelFrameBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer } },
                { binding: 2, resource: { buffer: this.cameraBuffer } },
            ],
        })) as [GPUBindGroup, GPUBindGroup];
        const previous = this.graph;
        this.graph = {
            nodes: [nodeBuffer, alternateNodes], radii: radiusBuffer, radiusBindGroups,
            edges: edgeBuffer, highlight: highlightBuffer,
            nodeColors: nodeColorBuffer, edgeColors: edgeColorBuffer, edgeWidths: edgeWidthBuffer,
            arrowLengths: arrowBuffer,
            nodeColorData, selected: new Uint8Array(nodeCount),
            pinData, pinIndices: new Set(),
            flags, searchMask: new Uint8Array(nodeCount), activeSearch: null,
            bindGroups, labelFrameBindGroups, layout: null,
            initialNodes: spatialNodes, initialEdges: sortedEdges, edgeDistances: sortedDistances,
            layoutProfile, layoutDimensions,
            activeIndex: 0, nodeCount, edgeCount,
            arrowCount: sortedArrows.subarray(0, loopStart).filter(length => length > 0).length,
            loopArrowCount: sortedArrows.subarray(loopStart).filter(length => length > 0).length,
            loopStart, edgeOrder,
            foregroundEdges: new Uint32Array(0),
            bytes: nodes.byteLength * 2 + radiusBuffer.size + sortedEdges.byteLength + flags.byteLength +
                nodeColorData.byteLength + sortedColors.byteLength + sortedWidths.byteLength + sortedArrows.byteLength,
        };
        this.focusNode = null;
        if (previous) {
            this.device.queue.onSubmittedWorkDone().then(() => {
                previous.layout?.destroy();
                previous.nodes[0].destroy();
                previous.nodes[1].destroy();
                previous.radii.destroy();
                previous.edges.destroy();
                previous.highlight.destroy();
                previous.nodeColors.destroy();
                previous.edgeColors.destroy();
                previous.edgeWidths.destroy();
                previous.arrowLengths.destroy();
            });
        }
    }

    setColors(nodes: Float32Array, edges: Float32Array, widths?: Float32Array, arrows?: Float32Array): void {
        const graph = this.graph;
        if (!graph || nodes.length !== graph.nodeCount * 4 || edges.length !== graph.edgeCount * 4) return;
        if (nodes.length) {
            graph.nodeColorData.set(nodes);
            for (let i = 0; i < graph.nodeCount; i++) {
                if (graph.selected[i]) graph.nodeColorData[i * 4 + 3] = -Math.max(0.001, Math.abs(graph.nodeColorData[i * 4 + 3]!));
            }
            this.device.queue.writeBuffer(graph.nodeColors, 0, graph.nodeColorData);
        }
        if (edges.length) {
            const sorted = new Float32Array(edges.length);
            for (let i = 0; i < graph.edgeCount; i++) sorted.set(edges.subarray(graph.edgeOrder[i]! * 4, graph.edgeOrder[i]! * 4 + 4), i * 4);
            this.device.queue.writeBuffer(graph.edgeColors, 0, sorted);
        }
        if (widths?.length === graph.edgeCount && widths.length) {
            const sorted = Float32Array.from(graph.edgeOrder, index => widths[index]!);
            this.device.queue.writeBuffer(graph.edgeWidths, 0, sorted);
        }
        if (arrows?.length === graph.edgeCount && arrows.length) {
            const sorted = Float32Array.from(graph.edgeOrder, index => arrows[index]!);
            graph.arrowCount = sorted.subarray(0, graph.loopStart).filter(length => length > 0).length;
            graph.loopArrowCount = sorted.subarray(graph.loopStart).filter(length => length > 0).length;
            this.device.queue.writeBuffer(graph.arrowLengths, 0, sorted);
        }
    }

    /** Redraw a small result path above the full edge field without rebuilding the layout. */
    setForegroundEdges(indices: Uint32Array): void {
        const graph = this.graph;
        if (!graph) return;
        if (indices.length === 0) {
            graph.foregroundEdges = new Uint32Array(0);
            return;
        }
        const selected = new Set(indices);
        const sorted: number[] = [];
        for (let i = 0; i < graph.loopStart; i++) {
            if (selected.has(graph.edgeOrder[i]!)) sorted.push(i);
        }
        graph.foregroundEdges = Uint32Array.from(sorted);
    }

    /** Change node radii in place, preserving current GPU positions and force velocities. */
    setNodeRadii(radii: Float32Array): void {
        const graph = this.graph;
        if (!graph || radii.length !== graph.nodeCount || radii.length === 0) return;
        const normalized = new Float32Array(radii.length);
        for (let i = 0; i < radii.length; i++) {
            normalized[i] = Number.isFinite(radii[i]) ? Math.max(0.01, radii[i]!) : 1;
            graph.initialNodes[i * 4 + 3] = normalized[i]!;
        }
        graph.layout?.setNodeRadii(normalized);
        this.device.queue.writeBuffer(graph.radii, 0, normalized);
        const encoder = this.device.createCommandEncoder({ label: 'update graph node radii' });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.radiusPipeline);
        for (const bindGroup of graph.radiusBindGroups) {
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(graph.nodeCount / 256));
        }
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }

    setBackground(color: GPUColor): void { this.background = color; }

    setDecorations(flags: Uint32Array): void {
        const graph = this.graph;
        if (!graph || flags.length !== graph.nodeCount) return;
        const changed: number[] = [];
        for (let i = 0; i < flags.length; i++) {
            const selected = flags[i] ? 1 : 0;
            if (graph.selected[i] === selected) continue;
            graph.selected[i] = selected;
            const offset = i * 4 + 3;
            graph.nodeColorData[offset] = (selected ? -1 : 1) * Math.max(0.001, Math.abs(graph.nodeColorData[offset]!));
            changed.push(offset);
        }
        if (changed.length > 128) {
            this.device.queue.writeBuffer(graph.nodeColors, 0, graph.nodeColorData);
        } else {
            for (const offset of changed) {
                this.device.queue.writeBuffer(graph.nodeColors, offset * 4, graph.nodeColorData.subarray(offset, offset + 1));
            }
        }
    }

    setLabelAtlas(atlas: LabelAtlas): void {
        this.device.queue.copyExternalImageToTexture(
            { source: atlas.canvas },
            { texture: this.labelAtlas, premultipliedAlpha: false },
            [ATLAS_WIDTH, ATLAS_HEIGHT],
        );
    }

    setFocus(node: number | null, firstHop?: Uint32Array, secondHop?: Uint32Array): void {
        const graph = this.graph;
        if (!graph || this.focusNode === node) return;
        this.focusNode = node;
        for (let i = 0; i < graph.nodeCount; i++) graph.flags[i] = graph.flags[i]! & ~3;
        if (node !== null) {
            for (const neighbor of secondHop ?? []) graph.flags[neighbor] = graph.flags[neighbor]! | 1;
            for (const neighbor of firstHop ?? []) graph.flags[neighbor] = (graph.flags[neighbor]! & ~3) | 2;
            graph.flags[node] = (graph.flags[node]! & ~3) | 3;
        }
        this.device.queue.writeBuffer(graph.highlight, 0, graph.flags);
    }

    /** Packs search emphasis alongside the hover tiers in the existing GPU mask. */
    setSearchHighlights(matches: Uint32Array, active: number | null): void {
        const graph = this.graph;
        if (!graph) return;
        graph.searchMask.fill(0);
        for (const index of matches) if (index < graph.nodeCount) graph.searchMask[index] = 1;
        graph.activeSearch = active !== null && active >= 0 && active < graph.nodeCount ? active : null;
        if (graph.activeSearch !== null) graph.searchMask[graph.activeSearch] = 2;
        for (let i = 0; i < graph.nodeCount; i++) {
            graph.flags[i] = (graph.flags[i]! & 3) | (graph.searchMask[i]! << 2);
        }
        if (graph.nodeCount) this.device.queue.writeBuffer(graph.highlight, 0, graph.flags);
    }

    /** Enter cycling only changes two mask words, even on very large graphs. */
    setActiveSearchHighlight(active: number | null): void {
        const graph = this.graph;
        if (!graph) return;
        const next = active !== null && active >= 0 && active < graph.nodeCount && graph.searchMask[active] > 0
            ? active : null;
        if (next === graph.activeSearch) return;
        if (graph.activeSearch !== null) {
            const previous = graph.activeSearch;
            graph.searchMask[previous] = 1;
            graph.flags[previous] = (graph.flags[previous]! & 3) | 4;
            this.device.queue.writeBuffer(graph.highlight, previous * 4, graph.flags.subarray(previous, previous + 1));
        }
        graph.activeSearch = next;
        if (next !== null) {
            graph.searchMask[next] = 2;
            graph.flags[next] = (graph.flags[next]! & 3) | 8;
            this.device.queue.writeBuffer(graph.highlight, next * 4, graph.flags.subarray(next, next + 1));
        }
    }

    isPinned(node: number): boolean {
        const graph = this.graph;
        return Boolean(graph?.pinIndices.has(node));
    }

    pinNode(node: number, x: number, y: number, z?: number): void {
        const graph = this.graph;
        if (!graph || node < 0 || node >= graph.nodeCount || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const offset = node * 4;
        graph.pinIndices.add(node);
        graph.pinData.set([x, y, z ?? graph.initialNodes[offset + 2]!], node * 3);
        graph.layout?.includePinnedPosition(x, y);
        // The radius sign is a pin flag shared by the render and compute passes.
        const pinnedNode = new Float32Array([x, y, graph.pinData[node * 3 + 2]!, -Math.abs(graph.initialNodes[offset + 3]!)]);
        for (const buffer of graph.nodes) this.device.queue.writeBuffer(buffer, offset * 4, pinnedNode);
        graph.layout?.clearVelocity(node);
    }

    unpinNode(node: number): void {
        const graph = this.graph;
        if (!graph || !this.isPinned(node)) return;
        const offset = node * 4;
        graph.pinIndices.delete(node);
        const radius = new Float32Array([Math.abs(graph.initialNodes[offset + 3]!)]);
        for (const buffer of graph.nodes) this.device.queue.writeBuffer(buffer, offset * 4 + 12, radius);
        graph.layout?.clearVelocity(node);
    }

    clearPins(): void {
        const graph = this.graph;
        if (!graph || graph.pinIndices.size === 0) return;
        for (const node of graph.pinIndices) {
            const offset = node * 4;
            const radius = new Float32Array([Math.abs(graph.initialNodes[offset + 3]!)]);
            for (const buffer of graph.nodes) this.device.queue.writeBuffer(buffer, offset * 4 + 12, radius);
        }
        graph.pinIndices.clear();
    }

    get graphInfo(): { nodeCount: number; edgeCount: number; bytes: number } | null {
        if (!this.graph) return null;
        return { nodeCount: this.graph.nodeCount, edgeCount: this.graph.edgeCount, bytes: this.graph.bytes };
    }

    async prepareLayout(): Promise<boolean> {
        const graph = this.graph;
        if (!graph) return false;
        if (graph.layout) return true;
        const layout = await GpuForceLayout.create(this.device, graph.initialNodes, graph.initialEdges, graph.nodes,
            graph.edgeDistances, () => this.graph === graph, graph.layoutProfile, graph.layoutDimensions);
        if (!layout) return false;
        graph.layout = layout;
        layout.setNodeRadii(Float32Array.from({ length: graph.nodeCount }, (_, i) =>
            Math.abs(graph.initialNodes[i * 4 + 3]!)));
        layout.updateProfile(graph.layoutProfile);
        for (const node of graph.pinIndices) {
            layout.includePinnedPosition(graph.pinData[node * 3]!, graph.pinData[node * 3 + 1]!);
        }
        return true;
    }

    setLayoutProfile(profile: LayoutProfile): void {
        const graph = this.graph;
        if (!graph) return;
        graph.layoutProfile = profile;
        graph.layout?.updateProfile(profile);
    }

    setLayoutDimensions(dimensions: 2 | 3): void {
        const graph = this.graph;
        if (!graph) return;
        graph.layoutDimensions = dimensions;
        graph.layout?.setDimensions(dimensions);
    }

    /** Advance the solver before the graph is displayed, yielding between short GPU batches. */
    async warmupLayout(maxMilliseconds: number, maxTicks: number, isCurrent: () => boolean): Promise<number> {
        const graph = this.graph;
        if (!graph?.layout || maxMilliseconds <= 0 || maxTicks <= 0) return 0;
        const started = performance.now();
        const batchLimit = graph.edgeCount >= 250_000 ? 2 : graph.edgeCount >= 50_000 ? 4 : 8;
        let ticks = 0;
        while (ticks < maxTicks && performance.now() - started < maxMilliseconds &&
            this.graph === graph && isCurrent()) {
            const batch = Math.min(batchLimit, maxTicks - ticks);
            for (let i = 0; i < batch; i++) {
                // Keep warmup submissions short so cancellation can take effect
                // between GPU batches.
                const encoder = this.device.createCommandEncoder();
                graph.activeIndex = graph.layout.encode(encoder);
                this.device.queue.submit([encoder.finish()]);
            }
            await this.device.queue.onSubmittedWorkDone();
            ticks += batch;
            if (this.graph !== graph || !isCurrent()) break;
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        return ticks;
    }

    resetLayout(): void {
        const graph = this.graph;
        if (!graph) return;
        this.clearPins();
        graph.layout?.reset();
        graph.activeIndex = 0;
        if (!graph.layout) {
            this.device.queue.writeBuffer(graph.nodes[0], 0, graph.initialNodes);
            this.device.queue.writeBuffer(graph.nodes[1], 0, graph.initialNodes);
        }
    }

    get layoutTicks(): number { return this.graph?.layout?.ticks ?? 0; }

    /** Readback is asynchronous and never blocks the render loop. */
    async snapshotPositions(): Promise<Float32Array | null> {
        const graph = this.graph;
        if (!graph?.layout || this.snapshotPending) return null;
        this.snapshotPending = true;
        const staging = this.device.createBuffer({
            size: graph.nodeCount * 16,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            label: 'asynchronous layout position snapshot',
        });
        try {
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(graph.nodes[graph.activeIndex], 0, staging, 0, graph.nodeCount * 16);
            this.device.queue.submit([encoder.finish()]);
            await staging.mapAsync(GPUMapMode.READ);
            if (this.graph !== graph) return null;
            const snapshot = new Float32Array(staging.getMappedRange().slice(0));
            for (const node of graph.pinIndices) {
                const offset = node * 4;
                snapshot[offset] = graph.pinData[node * 3]!;
                snapshot[offset + 1] = graph.pinData[node * 3 + 1]!;
                snapshot[offset + 2] = graph.pinData[node * 3 + 2]!;
            }
            return snapshot;
        } finally {
            staging.destroy();
            this.snapshotPending = false;
        }
    }

    private getDepthTexture(width: number, height: number): GPUTexture {
        if (this.depthTexture && this.depthWidth === width && this.depthHeight === height) return this.depthTexture;
        const previous = this.depthTexture;
        this.depthTexture = this.device.createTexture({
            size: [width, height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: 'graph view depth',
        });
        this.depthWidth = width;
        this.depthHeight = height;
        if (previous) void this.device.queue.onSubmittedWorkDone().then(() => previous.destroy());
        return this.depthTexture;
    }

    draw(camera: CameraState, edgeStyle: EdgeStyle, showNodes: boolean, outlineWidth: number, width: number, height: number, labels: LabelFrame | null, stepLayout: boolean | number = false): FrameWork {
        const graph = this.graph;
        if (!graph || width < 1 || height < 1) return { cpuSubmitMs: 0, layoutEncodeMs: 0, layoutSteps: 0, drawCalls: 0, vertices: 0, layoutTick: false, layoutTicks: 0 };
        if (!camera.mode3d && this.depthTexture) {
            const previous = this.depthTexture;
            this.depthTexture = null;
            this.depthWidth = 0;
            this.depthHeight = 0;
            void this.device.queue.onSubmittedWorkDone().then(() => previous.destroy());
        }
        const started = performance.now();
        this.cameraData.set([camera.centerX, camera.centerY, camera.scale, camera.stroke, width, height]);
        this.cameraWords[6] = this.focusNode ?? 0xffffffff;
        this.cameraData[7] = outlineWidth;
        this.cameraWords[8] = camera.mode3d ? 1 : 0;
        this.cameraData.set([
            Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch),
            camera.distance, camera.referenceDistance, camera.pixelRatio ?? 1,
        ], 9);
        this.cameraData[16] = camera.centerZ ?? 0;
        this.cameraData[17] = graph.activeSearch !== null &&
            !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
            ? started * 0.001 : -1;
        this.device.queue.writeBuffer(this.cameraBuffer, 0, this.cameraData);
        if (labels?.glyphCount) this.device.queue.writeBuffer(this.labelBuffer, 0, labels.data);
        const encoder = this.device.createCommandEncoder();
        const requestedSteps = typeof stepLayout === 'number' ? Math.max(0, Math.floor(stepLayout)) : Number(stepLayout);
        const layoutStarted = performance.now();
        let layoutSteps = 0;
        if (graph.layout) {
            while (layoutSteps < requestedSteps) {
                graph.activeIndex = graph.layout.encode(encoder);
                layoutSteps++;
                // Keep input and camera work responsive even when encoding a
                // large graph's compute passes takes longer than expected.
                if (requestedSteps > 1 && performance.now() - layoutStarted >= 6) break;
            }
        }
        const layoutTick = layoutSteps > 0;
        const layoutEncodeMs = layoutTick ? performance.now() - layoutStarted : 0;
        const passDescriptor: GPURenderPassDescriptor = { colorAttachments: [{
            view: this.context.getCurrentTexture().createView(),
            clearValue: this.background,
            loadOp: 'clear',
            storeOp: 'store',
        }] };
        if (camera.mode3d) passDescriptor.depthStencilAttachment = {
            view: this.getDepthTexture(width, height).createView(),
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
        };
        const pass = encoder.beginRenderPass(passDescriptor);
        pass.setBindGroup(0, graph.bindGroups[graph.activeIndex]);
        let vertices = 0;
        if (edgeStyle === 'thin') {
            pass.setPipeline(camera.mode3d ? this.linePipeline : this.linePipeline2D);
            pass.draw(graph.loopStart * 2);
            vertices += graph.loopStart * 2;
        } else {
            pass.setPipeline(camera.mode3d ? this.smoothPipeline : this.smoothPipeline2D);
            pass.draw(6, graph.loopStart);
            vertices += graph.loopStart * 6;
        }
        if (graph.loopStart < graph.edgeCount) {
            pass.setPipeline(camera.mode3d ? this.loopPipeline : this.loopPipeline2D);
            pass.draw(144, graph.edgeCount - graph.loopStart, 0, graph.loopStart);
            vertices += (graph.edgeCount - graph.loopStart) * 144;
        }
        if (graph.foregroundEdges.length) {
            pass.setPipeline(camera.mode3d ? this.smoothPipeline : this.smoothPipeline2D);
            for (const index of graph.foregroundEdges) {
                pass.draw(6, 1, 0, index);
                vertices += 6;
            }
        }
        if (graph.arrowCount) {
            pass.setPipeline(camera.mode3d ? this.arrowPipeline : this.arrowPipeline2D);
            pass.draw(3, graph.loopStart);
            vertices += graph.loopStart * 3;
        }
        if (graph.loopArrowCount) {
            pass.setPipeline(camera.mode3d ? this.loopArrowPipeline : this.loopArrowPipeline2D);
            pass.draw(3, graph.edgeCount - graph.loopStart, 0, graph.loopStart);
            vertices += (graph.edgeCount - graph.loopStart) * 3;
        }
        if (showNodes) {
            pass.setPipeline(camera.mode3d ? this.nodePipeline : this.nodePipeline2D);
            pass.draw(6, graph.nodeCount);
            vertices += graph.nodeCount * 6;
        }
        if (labels?.glyphCount) {
            pass.setPipeline(camera.mode3d ? this.labelPipeline : this.labelPipeline2D);
            pass.setBindGroup(0, graph.labelFrameBindGroups[graph.activeIndex]);
            pass.setBindGroup(1, this.labelBindGroup);
            pass.draw(6, labels.glyphCount);
            vertices += labels.glyphCount * 6;
        }
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        return { cpuSubmitMs: performance.now() - started, layoutEncodeMs, layoutSteps,
            drawCalls: 1 + graph.foregroundEdges.length + Number(graph.loopStart < graph.edgeCount) + Number(graph.arrowCount > 0) +
                Number(graph.loopArrowCount > 0) +
                Number(showNodes) + Number(Boolean(labels?.glyphCount)), vertices,
            layoutTick, layoutTicks: graph.layout?.ticks ?? 0 };
    }

    whenSubmittedWorkDone(): Promise<void> { return this.device.queue.onSubmittedWorkDone(); }

    destroy(): void {
        this.graph?.layout?.destroy();
        this.graph?.nodes[0].destroy();
        this.graph?.nodes[1].destroy();
        this.graph?.edges.destroy();
        this.graph?.highlight.destroy();
        this.graph?.nodeColors.destroy();
        this.graph?.edgeColors.destroy();
        this.graph?.edgeWidths.destroy();
        this.graph?.arrowLengths.destroy();
        this.depthTexture?.destroy();
        this.cameraBuffer.destroy();
        this.labelBuffer.destroy();
        this.labelAtlas.destroy();
        this.context.unconfigure();
        this.device.destroy();
    }
}
