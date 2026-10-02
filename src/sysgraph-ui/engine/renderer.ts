import { cameraBasis, orientationForCamera, type Quaternion } from './camera-orientation.js';
import { DEFAULT_LAYOUT_PROFILE, GpuForceLayout, type LayoutProfile } from './force-layout.js';
import { gridPlaneBounds } from './grid-plane.js';
import { GRID_SHADER } from './grid-shader.js';
import { ATLAS_HEIGHT, ATLAS_WIDTH, createLabelAtlas, type LabelAtlas, type LabelFrame, MAX_LABEL_INSTANCES } from './labels.js';
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
    orientation?: Quaternion;
    distance: number;
    referenceDistance: number;
    projection?: 'perspective' | 'orthographic';
    nodeStyle?: 'simple' | 'solid';
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
// The default node opacity is 0.95; keep its depth stable without three full
// node passes. Strongly dimmed nodes still use a nearest-surface color pass.
const OPAQUE_NODE_THRESHOLD = 0.949;

function hasTranslucentNodeColor(colors: Float32Array): boolean {
    for (let i = 3; i < colors.length; i += 4) {
        const alpha = Math.abs(colors[i]!);
        if (alpha >= 0.001 && alpha < OPAQUE_NODE_THRESHOLD) return true;
    }
    return false;
}

function unavailableWebGpuMessage(): string {
    const origin = typeof location === 'undefined' ? 'unknown origin' : location.origin;
    if (typeof isSecureContext === 'boolean' && !isSecureContext) {
        return `WebGPU is blocked because this page is not a secure context (${origin}). Open it over HTTPS, or forward the server port and use http://localhost on this computer.`;
    }
    return `WebGPU is not exposed to this page (${origin}). Check WebGPU support and browser settings for this tab, then reload.`;
}

/** Some browsers reject a power preference even though their default adapter works. */
export async function requestWebGpuAdapter(gpu: GPU): Promise<GPUAdapter> {
    let preferredError: unknown;
    try {
        const preferred = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (preferred) return preferred;
    } catch (error) {
        preferredError = error;
    }
    try {
        const fallback = await gpu.requestAdapter();
        if (fallback) return fallback;
    } catch (error) {
        throw new Error(`WebGPU is exposed, but adapter selection failed: ${String(error)}`);
    }
    const detail = preferredError ? ` Preferred adapter error: ${String(preferredError)}` : '';
    throw new Error(`WebGPU is exposed, but this browser returned no GPU adapter. Check hardware acceleration and browser GPU settings.${detail}`);
}

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
    renderLayer: u32,
    sceneBrightness: f32,
    gridStep: f32,
    lightTheme: f32,
    distance: f32,
    referenceDistance: f32,
    pixelRatio: f32,
    centerZ: f32,
    searchTime: f32,
    orthographic: u32,
    solidNodes: u32,
    right: vec4f,
    down: vec4f,
    toward: vec4f,
}

@group(0) @binding(0) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(1) var<storage, read> edges: array<vec2u>;
@group(0) @binding(2) var<uniform> camera: Camera;
@group(0) @binding(3) var<storage, read> neighborFlags: array<u32>;
@group(0) @binding(5) var<storage, read> nodeColors: array<vec4f>;
@group(0) @binding(6) var<storage, read> edgeColors: array<vec4f>;
@group(0) @binding(7) var<storage, read> edgeWidths: array<f32>;
@group(0) @binding(8) var<storage, read> arrowLengths: array<f32>;

fn sceneColor(color: vec3f) -> vec3f {
    return min(color * camera.sceneBrightness, vec3f(1.0));
}

fn perspectiveNearPlane() -> f32 {
    return max(0.000001, min(camera.referenceDistance * 0.05, camera.distance * 0.1));
}

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
    visible: u32,
}

fn viewNode(index: u32) -> vec3f {
    let relative = vec3f(nodes[index].xy - camera.center, nodes[index].z - camera.centerZ);
    return vec3f(dot(camera.right.xyz, relative), dot(camera.down.xyz, relative),
        dot(camera.toward.xyz, relative));
}

fn projectView(rotated: vec3f) -> Projected {
    let near = perspectiveNearPlane();
    let rawDistance = camera.distance - rotated.z;
    let eyeDistance = max(rawDistance, near);
    let factor = select(camera.referenceDistance / eyeDistance, 1.0, camera.orthographic == 1u);
    let screen = rotated.xy * camera.scale * factor + camera.viewport * 0.5;
    let perspectiveDepth = 1.0 - near / eyeDistance;
    let orthographicDepth = 0.5 - rotated.z / (camera.referenceDistance * 4.0);
    let normalizedDepth = clamp(select(perspectiveDepth, orthographicDepth, camera.orthographic == 1u), 0.0, 1.0);
    let visible = select(0u, 1u, camera.orthographic == 1u || rawDistance >= near);
    return Projected(screen, normalizedDepth, factor, visible);
}

fn projectNode(index: u32) -> Projected {
    if (camera.mode3d == 0u) {
        return Projected((nodes[index].xy - camera.center) * camera.scale + camera.viewport * 0.5,
            0.5, 1.0, 1u);
    }
    return projectView(viewNode(index));
}

struct ProjectedLink {
    source: Projected,
    destination: Projected,
    visible: u32,
    sourceClipped: u32,
    destinationClipped: u32,
}

fn projectLink(endpoints: vec2u) -> ProjectedLink {
    if (camera.mode3d == 0u || camera.orthographic == 1u) {
        return ProjectedLink(projectNode(endpoints.x), projectNode(endpoints.y), 1u, 0u, 0u);
    }
    var source = viewNode(endpoints.x);
    var destination = viewNode(endpoints.y);
    let near = perspectiveNearPlane();
    let sourceDistance = camera.distance - source.z;
    let destinationDistance = camera.distance - destination.z;
    if (sourceDistance < near && destinationDistance < near) {
        return ProjectedLink(projectView(source), projectView(destination), 0u, 1u, 1u);
    }
    if (sourceDistance < near) {
        source = mix(source, destination, (near - sourceDistance) / (destinationDistance - sourceDistance));
    } else if (destinationDistance < near) {
        destination = mix(source, destination, (sourceDistance - near) / (sourceDistance - destinationDistance));
    }
    return ProjectedLink(projectView(source), projectView(destination), 1u,
        select(0u, 1u, sourceDistance < near), select(0u, 1u, destinationDistance < near));
}

fn nodeScreenRadius(index: u32, perspectiveFactor: f32) -> f32 {
    let maxRadius = select(${MAX_NODE_SCREEN_RADIUS} * camera.pixelRatio,
        max(camera.viewport.x, camera.viewport.y), camera.mode3d == 1u);
    return clamp(abs(nodes[index].w) * camera.scale * perspectiveFactor,
        ${MIN_NODE_SCREEN_RADIUS} * camera.pixelRatio, maxRadius);
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

fn edgeInLayer(tier: u32) -> bool {
    if (camera.renderLayer == 1u) { return tier > 1u; }
    if (camera.renderLayer == 2u) { return tier == 1u; }
    return true;
}

struct LineVertex {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) @interpolate(flat) focusTier: u32,
}

@vertex fn lineVertex(@builtin(vertex_index) vertex: u32) -> LineVertex {
    let endpoints = edges[vertex / 2u];
    let link = projectLink(endpoints);
    var projected = link.source;
    if ((vertex & 1u) == 1u) { projected = link.destination; }
    var out: LineVertex;
    out.position = select(vec4f(2.0, 2.0, 0.0, 1.0), clipPosition(projected.screen, projected.depth),
        link.visible == 1u);
    out.color = edgeColors[vertex / 2u];
    out.focusTier = edgeFocusTier(endpoints);
    return out;
}

@fragment fn lineFragment(in: LineVertex) -> @location(0) vec4f {
    if (!edgeInLayer(in.focusTier)) { discard; }
    let alpha = select(min(1.0, in.color.a * edgeFocusAlpha(in.focusTier)),
                       in.color.a, camera.focusNode == 0xffffffffu);
    if (alpha < 0.001) { discard; }
    return vec4f(sceneColor(in.color.rgb), alpha);
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
    let link = projectLink(endpoints);
    let projectedA = link.source;
    let projectedB = link.destination;
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
    out.position = select(vec4f(2.0, 2.0, 0.0, 1.0),
        clipPosition(point, select(projectedA.depth, projectedB.depth, atEnd)), link.visible == 1u);
    out.color = edgeColors[instance];
    out.signedDistance = side * outer;
    out.focusTier = edgeFocusTier(endpoints);
    out.halfWidth = halfWidth;
    return out;
}

@fragment fn smoothFragment(in: SmoothVertex) -> @location(0) vec4f {
    if (!edgeInLayer(in.focusTier)) { discard; }
    let halfWidth = in.halfWidth;
    let coverage = 1.0 - smoothstep(halfWidth - 0.7, halfWidth + 0.7, abs(in.signedDistance));
    let alpha = coverage * select(min(1.0, in.color.a * edgeFocusAlpha(in.focusTier)),
                                  in.color.a, camera.focusNode == 0xffffffffu);
    if (alpha < 0.001) { discard; }
    return vec4f(sceneColor(in.color.rgb), alpha);
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
    let link = projectLink(endpoints);
    let source = link.source;
    let destination = link.destination;
    let delta = destination.screen - source.screen;
    let distance = length(delta);
    let lengthPx = clamp(arrowLengths[instance] * 1.3, 5.0, 20.0) * camera.pixelRatio;
    let sourceRadius = select(nodeScreenRadius(endpoints.x, source.factor), 0.0, link.sourceClipped == 1u);
    let targetRadius = select(nodeScreenRadius(endpoints.y, destination.factor), 0.0, link.destinationClipped == 1u);
    var out: ArrowVertex;
    if (link.visible == 0u || arrowLengths[instance] <= 0.0 ||
        distance < sourceRadius + targetRadius + lengthPx + 4.0) {
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
    let vertexT = clamp(t + axial / distance, 0.0, 1.0);
    out.position = clipPosition(center + direction * axial + normal * lateral,
                                mix(source.depth, destination.depth, vertexT));
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
    if (arrowLengths[instance] <= 0.0 || projected.visible == 0u) {
        out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    }
    out.color = edgeColors[instance];
    out.focusTier = edgeFocusTier(edges[instance]);
    out.local = vec2f(axial + lengthPx * 0.5, lateral);
    out.size = vec2f(lengthPx, halfWidth);
    return out;
}

@fragment fn arrowFragment(in: ArrowVertex) -> @location(0) vec4f {
    if (!edgeInLayer(in.focusTier)) { discard; }
    let axial = in.local.x;
    let edge = (1.0 - axial / in.size.x) * in.size.y - abs(in.local.y);
    let coverage = smoothstep(0.0, 1.0, min(min(axial, in.size.x - axial), edge));
    var alpha = in.color.a * coverage;
    if (camera.focusNode != 0xffffffffu) {
        alpha *= edgeFocusAlpha(in.focusTier);
    }
    if (alpha < 0.001) { discard; }
    return vec4f(sceneColor(in.color.rgb), min(1.0, alpha));
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
    out.position = select(vec4f(2.0, 2.0, 0.0, 1.0),
        clipPosition(projected.screen + offset + vec2f(cos(angle), sin(angle)) * side * outer, projected.depth),
        projected.visible == 1u);
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
    @location(7) @interpolate(flat) perspectiveFactor: f32,
    @location(8) @interpolate(flat) surfaceRadius: f32,
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
    out.position = select(vec4f(2.0, 2.0, 0.0, 1.0),
        clipPosition(projected.screen + offset, projected.depth), projected.visible == 1u);
    out.color = nodeColors[instance];
    out.offset = offset;
    out.radius = radius;
    out.flag = flag;
    out.pinned = pinned;
    out.selected = selected;
    out.searchStatus = searchStatus;
    out.perspectiveFactor = projected.factor;
    out.surfaceRadius = radius;
    return out;
}

fn nodeCoverageWidth() -> f32 {
    return max(0.8, camera.pixelRatio * 0.7);
}

fn nodeOpacity(in: NodeVertex) -> f32 {
    var opacity = abs(in.color.a);
    if (camera.focusNode != 0xffffffffu) {
        if (in.flag == 1u) { opacity *= 0.5; }
        if (in.flag == 0u) { opacity *= 0.1; }
    }
    if (in.searchStatus == 1u) { opacity = max(opacity, abs(in.color.a) * 0.65); }
    if (in.searchStatus == 2u) { opacity = abs(in.color.a); }
    return opacity;
}

fn nodeInLayer(in: NodeVertex) -> bool {
    if (camera.renderLayer == 1u) { return in.flag < 2u; }
    if (camera.renderLayer == 2u) { return in.flag >= 2u; }
    return true;
}

const OPAQUE_NODE_THRESHOLD: f32 = 0.949;

fn shadeNode(in: NodeVertex) -> vec4f {
    let distance = length(in.offset);
    let aa = nodeCoverageWidth();
    let body = 1.0 - smoothstep(in.radius - aa, in.radius + aa, distance);
    var bodyColor = in.color.rgb;
    if (camera.mode3d == 1u && camera.solidNodes == 1u && distance < in.radius) {
        let normalXY = in.offset / max(in.radius, 0.001);
        let normal = vec3f(normalXY, sqrt(max(0.0, 1.0 - dot(normalXY, normalXY))));
        // Sphere normals are in view space; the key light stays fixed in world space.
        let worldKey = normalize(vec3f(-0.55, -0.68, 0.75));
        let key = normalize(vec3f(dot(camera.right.xyz, worldKey),
            dot(camera.down.xyz, worldKey), dot(camera.toward.xyz, worldKey)));
        let lambert = max(dot(normal, key), 0.0);
        let diffuse = 0.35 + 0.60 * lambert;
        let halfVector = key + vec3f(0.0, 0.0, 1.0);
        let halfNormal = halfVector / max(length(halfVector), 0.001);
        let highlight = pow(max(dot(normal, halfNormal), 0.0), 28.0)
            * smoothstep(0.0, 0.15, lambert);
        bodyColor = min(in.color.rgb * diffuse + vec3f(0.18) * highlight, vec3f(1.0));
    }
    let opacity = nodeOpacity(in);
    var alpha = body * opacity;
    var color = bodyColor;
    if (camera.outlineWidth > 0.0) {
        let outer = 1.0 - smoothstep(in.radius + camera.outlineWidth - aa,
                                      in.radius + camera.outlineWidth + aa, distance);
        let ring = max(0.0, outer - body);
        let ringOpacity = opacity * select(0.85, 0.55, camera.mode3d == 1u);
        let combined = alpha + ring * ringOpacity;
        let outlineColor = mix(in.color.rgb, vec3f(1.0), select(0.58, 0.38, camera.mode3d == 1u));
        color = (bodyColor * alpha + outlineColor * ring * ringOpacity) / max(combined, 0.0001);
        alpha = combined;
    }
    if (in.selected == 1u) {
        let outer = 1.0 - smoothstep(in.radius + camera.outlineWidth + 2.2,
                                      in.radius + camera.outlineWidth + 3.2, distance);
        let inner = 1.0 - smoothstep(in.radius + camera.outlineWidth + 0.5,
                                      in.radius + camera.outlineWidth + 1.2, distance);
        let ring = max(0.0, outer - inner);
        let ringAlpha = ring * opacity;
        let combined = alpha + ringAlpha * (1.0 - alpha);
        color = (color * alpha + vec3f(0.96, 0.23, 0.24) * ringAlpha * (1.0 - alpha)) / max(combined, 0.0001);
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
    return vec4f(sceneColor(color), alpha);
}

@fragment fn nodeFragment(in: NodeVertex) -> @location(0) vec4f {
    if (!nodeInLayer(in)) { discard; }
    return shadeNode(in);
}

@fragment fn mutedNodeFragment(in: NodeVertex) -> @location(0) vec4f {
    if (!nodeInLayer(in) || in.searchStatus > 0u) { discard; }
    return shadeNode(in);
}

@fragment fn matchedNodeFragment(in: NodeVertex) -> @location(0) vec4f {
    if (!nodeInLayer(in) || in.searchStatus == 0u) { discard; }
    return shadeNode(in);
}

struct NodeSurfaceFragment {
    @location(0) color: vec4f,
    @builtin(frag_depth) depth: f32,
}

fn nodeSurfaceDepth(in: NodeVertex) -> f32 {
    let radiusDepth = sqrt(max(0.0, in.surfaceRadius * in.surfaceRadius - dot(in.offset, in.offset)))
        / max(camera.scale * in.perspectiveFactor, 0.00001);
    let near = perspectiveNearPlane();
    let perspectiveDistance = camera.referenceDistance / max(in.perspectiveFactor, 0.00001);
    let perspectiveDepth = 1.0 - near / max(perspectiveDistance - radiusDepth, near);
    let orthographicDepth = in.position.z - radiusDepth / (camera.referenceDistance * 4.0);
    return clamp(select(perspectiveDepth, orthographicDepth, camera.orthographic == 1u), 0.0, 1.0);
}

@fragment fn surfaceNodeCoreFragment(in: NodeVertex) -> NodeSurfaceFragment {
    if (!nodeInLayer(in)) { discard; }
    if (length(in.offset) >= in.radius - nodeCoverageWidth() || nodeOpacity(in) < OPAQUE_NODE_THRESHOLD) { discard; }
    var out: NodeSurfaceFragment;
    out.color = shadeNode(in);
    out.depth = nodeSurfaceDepth(in);
    return out;
}

@fragment fn surfaceNodeTranslucentFragment(in: NodeVertex) -> NodeSurfaceFragment {
    if (!nodeInLayer(in)) { discard; }
    if (length(in.offset) >= in.radius - nodeCoverageWidth() || nodeOpacity(in) >= OPAQUE_NODE_THRESHOLD) { discard; }
    var out: NodeSurfaceFragment;
    out.color = shadeNode(in);
    out.depth = nodeSurfaceDepth(in);
    return out;
}

@fragment fn surfaceNodeTranslucentDepthFragment(in: NodeVertex) -> NodeSurfaceFragment {
    if (!nodeInLayer(in)) { discard; }
    let opacity = nodeOpacity(in);
    if (length(in.offset) >= in.radius - nodeCoverageWidth() || opacity >= OPAQUE_NODE_THRESHOLD || opacity < 0.001) { discard; }
    var out: NodeSurfaceFragment;
    out.color = vec4f(0.0);
    out.depth = nodeSurfaceDepth(in);
    return out;
}

// Labels use a fresh depth buffer containing only visible node surfaces.
// Translucent edges still write depth in the graph pass for correct crossings,
// but must not make a later text glyph disappear completely.
@fragment fn labelNodeDepthFragment(in: NodeVertex) -> NodeSurfaceFragment {
    if (!nodeInLayer(in) || length(in.offset) >= in.radius - nodeCoverageWidth() || nodeOpacity(in) < 0.001) { discard; }
    var out: NodeSurfaceFragment;
    out.color = vec4f(0.0);
    out.depth = nodeSurfaceDepth(in);
    return out;
}

@fragment fn surfaceNodeRimFragment(in: NodeVertex) -> NodeSurfaceFragment {
    if (!nodeInLayer(in)) { discard; }
    if (length(in.offset) < in.radius - nodeCoverageWidth()) { discard; }
    var out: NodeSurfaceFragment;
    out.color = shadeNode(in);
    out.depth = nodeSurfaceDepth(in);
    return out;
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
    renderLayer: u32,
    sceneBrightness: f32,
    gridStep: f32,
    lightTheme: f32,
    distance: f32,
    referenceDistance: f32,
    pixelRatio: f32,
    centerZ: f32,
    searchTime: f32,
    orthographic: u32,
    solidNodes: u32,
    right: vec4f,
    down: vec4f,
    toward: vec4f,
}

struct Glyph {
    rect: vec4f,
    uv: vec4f,
    node: u32,
    opacity: f32,
    plate: u32,
    pad2: u32,
}

@group(0) @binding(2) var<uniform> camera: Camera;
@group(0) @binding(0) var<storage, read> nodes: array<vec4f>;
@group(1) @binding(0) var<storage, read> glyphs: array<Glyph>;
@group(1) @binding(1) var labelAtlas: texture_2d<f32>;
@group(1) @binding(2) var atlasSampler: sampler;

fn perspectiveNearPlane() -> f32 {
    return max(0.000001, min(camera.referenceDistance * 0.05, camera.distance * 0.1));
}

struct LabelVertex {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) opacity: f32,
    @location(2) local: vec2f,
    @location(3) size: vec2f,
    @location(4) @interpolate(flat) plate: u32,
    @location(5) @interpolate(flat) sampling: u32,
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
    var depth = 0.5;
    var visible = true;
    if (camera.mode3d == 1u) {
        let z = nodes[glyph.node].z - camera.centerZ;
        let relative = vec3f(delta, z);
        let rotated = vec3f(dot(camera.right.xyz, relative), dot(camera.down.xyz, relative),
            dot(camera.toward.xyz, relative));
        let viewZ = rotated.z;
        let rawDistance = camera.distance - viewZ;
        let near = perspectiveNearPlane();
        let eyeDistance = max(rawDistance, near);
        visible = camera.orthographic == 1u || rawDistance >= near;
        let perspectiveFactor = camera.referenceDistance / eyeDistance;
        let factor = select(perspectiveFactor, 1.0, camera.orthographic == 1u);
        anchor = rotated.xy * camera.scale * factor + camera.viewport * 0.5;
        let perspectiveDepth = 1.0 - near / eyeDistance;
        let orthographicDepth = 0.5 - viewZ / (camera.referenceDistance * 4.0);
        depth = clamp(select(perspectiveDepth, orthographicDepth, camera.orthographic == 1u), 0.0, 1.0);
    }
    var origin = anchor + glyph.rect.xy;
    if ((glyph.pad2 & 1u) != 0u) { origin = round(origin); }
    let screen = origin + vec2f(x, y) * glyph.rect.zw;
    var out: LabelVertex;
    out.position = vec4f(screen.x / camera.viewport.x * 2.0 - 1.0,
                         1.0 - screen.y / camera.viewport.y * 2.0, depth, 1.0);
    if (!visible) { out.position = vec4f(2.0, 2.0, 0.0, 1.0); }
    out.uv = mix(glyph.uv.xy, glyph.uv.zw, vec2f(x, y));
    out.opacity = glyph.opacity;
    out.local = vec2f(x, y) * glyph.rect.zw;
    out.size = glyph.rect.zw;
    out.plate = glyph.plate;
    out.sampling = glyph.pad2 & 2u;
    return out;
}

@fragment fn labelFragment(in: LabelVertex) -> @location(0) vec4f {
    let dx = dpdx(in.uv) * 0.288675;
    let dy = dpdy(in.uv) * 0.288675;
    if (in.plate != 0u) {
        let radius = min(in.uv.x, min(in.size.x, in.size.y) * 0.25);
        let halfSize = in.size * 0.5;
        let q = abs(in.local - halfSize) - (halfSize - vec2f(radius));
        let distance = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
        if (in.plate >= 3u) {
            // The optional soft-background style clears links beneath each
            // text line. Plain and outlined labels never emit these quads.
            let feather = max(in.uv.y, 1.0);
            let coverage = 1.0 - smoothstep(-feather, feather, distance);
            let color = select(vec3f(0.025, 0.052, 0.078), vec3f(1.0), in.plate == 4u);
            return vec4f(color, coverage * 0.97 * in.opacity);
        }
        let coverage = 1.0 - smoothstep(-1.0, 1.0, distance);
        let interior = 1.0 - smoothstep(-1.0, 1.0, distance + in.uv.y);
        let border = clamp(coverage - interior, 0.0, 1.0);
        let light = in.plate == 2u;
        let fillColor = select(vec3f(0.027, 0.078, 0.10), vec3f(0.95, 0.97, 0.98), light);
        let borderColor = select(vec3f(0.18, 0.34, 0.36), vec3f(0.64, 0.72, 0.77), light);
        let color = mix(fillColor, borderColor, border);
        return vec4f(color, coverage * select(0.90, 0.96, light) * in.opacity);
    }
    if (in.sampling == 0u) {
        let glyph = textureSampleLevel(labelAtlas, atlasSampler, in.uv, 0.0);
        return vec4f(glyph.rgb, glyph.a * in.opacity);
    }
    // Four taps cover the source footprint of one screen pixel. This reduces
    // the shimmer caused by shrinking the 3x canvas atlas with one bilinear tap.
    let a = textureSampleLevel(labelAtlas, atlasSampler, in.uv - dx - dy, 0.0);
    let b = textureSampleLevel(labelAtlas, atlasSampler, in.uv + dx - dy, 0.0);
    let c = textureSampleLevel(labelAtlas, atlasSampler, in.uv - dx + dy, 0.0);
    let d = textureSampleLevel(labelAtlas, atlasSampler, in.uv + dx + dy, 0.0);
    let coverage = (a.a + b.a + c.a + d.a) * 0.25;
    let premultiplied = (a.rgb * a.a + b.rgb * b.a + c.rgb * c.a + d.rgb * d.a) * 0.25;
    return vec4f(premultiplied / max(coverage, 0.00001), coverage * in.opacity);
}
`;

const FOCUS_CONTEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var contextLayer: texture_2d<f32>;

@vertex fn fullscreenVertex(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(positions[vertex], 0.0, 1.0);
}

@fragment fn compositeContext(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let accumulated = textureLoad(contextLayer, vec2i(position.xy), 0);
    if (accumulated.a < 0.001) { discard; }
    // The context target stores premultiplied color. Limit the combined alpha
    // so dense background links cannot wash out the highlighted neighborhood.
    let color = accumulated.rgb / max(accumulated.a, 0.00001);
    return vec4f(color, min(accumulated.a, 0.18));
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
    hasTranslucentNodes: boolean;
    selected: Uint8Array;
    pinData: Float32Array;
    pinIndices: Set<number>;
    flags: Uint32Array;
    searchMask: Uint8Array;
    hasSearchHighlights: boolean;
    activeSearch: number | null;
    bindGroups: [GPUBindGroup, GPUBindGroup];
    contextBindGroups: [GPUBindGroup, GPUBindGroup];
    pathBindGroups: [GPUBindGroup, GPUBindGroup];
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
    private readonly colorFormat: GPUTextureFormat;
    private readonly bindGroupLayout: GPUBindGroupLayout;
    private readonly labelFrameBindGroupLayout: GPUBindGroupLayout;
    private readonly cameraBuffer: GPUBuffer;
    private readonly contextCameraBuffer: GPUBuffer;
    private readonly pathCameraBuffer: GPUBuffer;
    private readonly radiusPipeline: GPUComputePipeline;
    private readonly cameraData = new Float32Array(32);
    private readonly cameraWords = new Uint32Array(this.cameraData.buffer);
    private readonly layerCameraData = new Float32Array(32);
    private readonly layerCameraWords = new Uint32Array(this.layerCameraData.buffer);
    private readonly contextCompositeLayout: GPUBindGroupLayout;
    private readonly contextCompositePipeline: GPURenderPipeline;
    private readonly gridPipeline: GPURenderPipeline;
    private readonly gridPipeline3D: GPURenderPipeline;
    private readonly gridBindGroup: GPUBindGroup;
    private readonly gridPlaneBuffer: GPUBuffer;
    private readonly linePipeline: GPURenderPipeline;
    private readonly lineNoDepthWritePipeline: GPURenderPipeline;
    private readonly linePipeline2D: GPURenderPipeline;
    private readonly smoothPipeline: GPURenderPipeline;
    private readonly smoothNoDepthWritePipeline: GPURenderPipeline;
    private readonly smoothPipeline2D: GPURenderPipeline;
    private readonly loopPipeline: GPURenderPipeline;
    private readonly loopNoDepthWritePipeline: GPURenderPipeline;
    private readonly loopPipeline2D: GPURenderPipeline;
    private readonly arrowPipeline: GPURenderPipeline;
    private readonly arrowNoDepthWritePipeline: GPURenderPipeline;
    private readonly arrowPipeline2D: GPURenderPipeline;
    private readonly loopArrowPipeline: GPURenderPipeline;
    private readonly loopArrowNoDepthWritePipeline: GPURenderPipeline;
    private readonly loopArrowPipeline2D: GPURenderPipeline;
    private readonly nodePipeline: GPURenderPipeline;
    private readonly labelNodeDepthPipeline: GPURenderPipeline;
    private readonly nodeTranslucentDepthPipeline: GPURenderPipeline;
    private readonly nodeTranslucentPipeline: GPURenderPipeline;
    private readonly nodeRimPipeline: GPURenderPipeline;
    private readonly nodePipeline2D: GPURenderPipeline;
    private readonly mutedNodePipeline2D: GPURenderPipeline;
    private readonly matchedNodePipeline2D: GPURenderPipeline;
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
    private contextTexture: GPUTexture | null = null;
    private contextView: GPUTextureView | null = null;
    private contextBindGroup: GPUBindGroup | null = null;
    private contextWidth = 0;
    private contextHeight = 0;
    private background: GPUColor = CLEAR;
    readonly adapterName: string;

    private constructor(
        device: GPUDevice,
        context: GPUCanvasContext,
        colorFormat: GPUTextureFormat,
        bindGroupLayout: GPUBindGroupLayout,
        labelFrameBindGroupLayout: GPUBindGroupLayout,
        cameraBuffer: GPUBuffer,
        contextCameraBuffer: GPUBuffer,
        pathCameraBuffer: GPUBuffer,
        contextCompositeLayout: GPUBindGroupLayout,
        contextCompositePipeline: GPURenderPipeline,
        gridPipeline: GPURenderPipeline,
        gridPipeline3D: GPURenderPipeline,
        gridBindGroup: GPUBindGroup,
        gridPlaneBuffer: GPUBuffer,
        radiusPipeline: GPUComputePipeline,
        linePipeline: GPURenderPipeline,
        lineNoDepthWritePipeline: GPURenderPipeline,
        linePipeline2D: GPURenderPipeline,
        smoothPipeline: GPURenderPipeline,
        smoothNoDepthWritePipeline: GPURenderPipeline,
        smoothPipeline2D: GPURenderPipeline,
        loopPipeline: GPURenderPipeline,
        loopNoDepthWritePipeline: GPURenderPipeline,
        loopPipeline2D: GPURenderPipeline,
        arrowPipeline: GPURenderPipeline,
        arrowNoDepthWritePipeline: GPURenderPipeline,
        arrowPipeline2D: GPURenderPipeline,
        loopArrowPipeline: GPURenderPipeline,
        loopArrowNoDepthWritePipeline: GPURenderPipeline,
        loopArrowPipeline2D: GPURenderPipeline,
        nodePipeline: GPURenderPipeline,
        labelNodeDepthPipeline: GPURenderPipeline,
        nodeTranslucentDepthPipeline: GPURenderPipeline,
        nodeTranslucentPipeline: GPURenderPipeline,
        nodeRimPipeline: GPURenderPipeline,
        nodePipeline2D: GPURenderPipeline,
        mutedNodePipeline2D: GPURenderPipeline,
        matchedNodePipeline2D: GPURenderPipeline,
        labelPipeline: GPURenderPipeline,
        labelPipeline2D: GPURenderPipeline,
        labelBuffer: GPUBuffer,
        labelAtlas: GPUTexture,
        labelBindGroup: GPUBindGroup,
        adapterName: string,
    ) {
        this.device = device;
        this.context = context;
        this.colorFormat = colorFormat;
        this.bindGroupLayout = bindGroupLayout;
        this.labelFrameBindGroupLayout = labelFrameBindGroupLayout;
        this.cameraBuffer = cameraBuffer;
        this.contextCameraBuffer = contextCameraBuffer;
        this.pathCameraBuffer = pathCameraBuffer;
        this.contextCompositeLayout = contextCompositeLayout;
        this.contextCompositePipeline = contextCompositePipeline;
        this.gridPipeline = gridPipeline;
        this.gridPipeline3D = gridPipeline3D;
        this.gridBindGroup = gridBindGroup;
        this.gridPlaneBuffer = gridPlaneBuffer;
        this.radiusPipeline = radiusPipeline;
        this.linePipeline = linePipeline;
        this.lineNoDepthWritePipeline = lineNoDepthWritePipeline;
        this.linePipeline2D = linePipeline2D;
        this.smoothPipeline = smoothPipeline;
        this.smoothNoDepthWritePipeline = smoothNoDepthWritePipeline;
        this.smoothPipeline2D = smoothPipeline2D;
        this.loopPipeline = loopPipeline;
        this.loopNoDepthWritePipeline = loopNoDepthWritePipeline;
        this.loopPipeline2D = loopPipeline2D;
        this.arrowPipeline = arrowPipeline;
        this.arrowNoDepthWritePipeline = arrowNoDepthWritePipeline;
        this.arrowPipeline2D = arrowPipeline2D;
        this.loopArrowPipeline = loopArrowPipeline;
        this.loopArrowNoDepthWritePipeline = loopArrowNoDepthWritePipeline;
        this.loopArrowPipeline2D = loopArrowPipeline2D;
        this.nodePipeline = nodePipeline;
        this.labelNodeDepthPipeline = labelNodeDepthPipeline;
        this.nodeTranslucentDepthPipeline = nodeTranslucentDepthPipeline;
        this.nodeTranslucentPipeline = nodeTranslucentPipeline;
        this.nodeRimPipeline = nodeRimPipeline;
        this.nodePipeline2D = nodePipeline2D;
        this.mutedNodePipeline2D = mutedNodePipeline2D;
        this.matchedNodePipeline2D = matchedNodePipeline2D;
        this.labelPipeline = labelPipeline;
        this.labelPipeline2D = labelPipeline2D;
        this.labelBuffer = labelBuffer;
        this.labelAtlas = labelAtlas;
        this.labelBindGroup = labelBindGroup;
        this.adapterName = adapterName;
    }

    static async create(canvas: HTMLCanvasElement, onDeviceLost: (message: string) => void): Promise<WebGPUGraphRenderer> {
        const gpu = navigator.gpu;
        if (!gpu) throw new Error(unavailableWebGpuMessage());
        const adapter = await requestWebGpuAdapter(gpu);
        let device: GPUDevice;
        try {
            device = await adapter.requestDevice();
        } catch (error) {
            throw new Error(`WebGPU adapter found, but device creation failed: ${String(error)}`);
        }
        const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
        if (!context) throw new Error('Could not create a WebGPU canvas context.');
        const format = gpu.getPreferredCanvasFormat();
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
        const contextCompositeModule = device.createShaderModule({ code: FOCUS_CONTEXT_SHADER });
        const contextDiagnostics = await contextCompositeModule.getCompilationInfo();
        const contextErrors = contextDiagnostics.messages.filter(message => message.type === 'error');
        if (contextErrors.length) throw new Error(`Focus composite WGSL compilation failed: ${contextErrors.map(error => error.message).join('; ')}`);
        const contextCompositeLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ] });
        const contextCompositePipeline = await device.createRenderPipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [contextCompositeLayout] }),
            vertex: { module: contextCompositeModule, entryPoint: 'fullscreenVertex' },
            fragment: { module: contextCompositeModule, entryPoint: 'compositeContext', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const gridModule = device.createShaderModule({ code: GRID_SHADER });
        const gridDiagnostics = await gridModule.getCompilationInfo();
        const gridErrors = gridDiagnostics.messages.filter(message => message.type === 'error');
        if (gridErrors.length) throw new Error(`Grid WGSL compilation failed: ${gridErrors.map(error => error.message).join('; ')}`);
        const gridLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ] });
        const gridPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [gridLayout] });
        const gridPipelineDescriptor = {
            layout: gridPipelineLayout,
            vertex: { module: gridModule, entryPoint: 'gridVertex' },
            fragment: { module: gridModule, entryPoint: 'gridFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        } satisfies GPURenderPipelineDescriptor;
        const gridPipeline = await device.createRenderPipelineAsync(gridPipelineDescriptor);
        const gridPipeline3D = await device.createRenderPipelineAsync({
            layout: gridPipelineLayout,
            vertex: { module: gridModule, entryPoint: 'gridPlaneVertex' },
            fragment: { module: gridModule, entryPoint: 'gridPlaneFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
        });
        // Keep the closest link at a crossing in front even when graph order
        // draws a farther translucent link later.
        const edgeDepth = { format: 'depth24plus' as GPUTextureFormat, depthWriteEnabled: true, depthCompare: 'less-equal' as GPUCompareFunction };
        // During path highlighting the faded edge field must still be depth
        // tested, but must not hide the emphasized path by writing depth first.
        const edgeDepthReadOnly = { ...edgeDepth, depthWriteEnabled: false };
        const linePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'lineVertex' },
            fragment: { module, entryPoint: 'lineFragment', targets: [{ format, blend }] },
            primitive: { topology: 'line-list' },
            depthStencil: edgeDepth,
        });
        const lineNoDepthWritePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'lineVertex' },
            fragment: { module, entryPoint: 'lineFragment', targets: [{ format, blend }] },
            primitive: { topology: 'line-list' },
            depthStencil: edgeDepthReadOnly,
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
        const smoothNoDepthWritePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'smoothVertex' },
            fragment: { module, entryPoint: 'smoothFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepthReadOnly,
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
        const loopNoDepthWritePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'loopVertex' },
            fragment: { module, entryPoint: 'smoothFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepthReadOnly,
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
        const arrowNoDepthWritePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'arrowVertex' },
            fragment: { module, entryPoint: 'arrowFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepthReadOnly,
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
        const loopArrowNoDepthWritePipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'loopArrowVertex' },
            fragment: { module, entryPoint: 'arrowFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: edgeDepthReadOnly,
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
            fragment: { module, entryPoint: 'surfaceNodeCoreFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        });
        const labelNodeDepthPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'labelNodeDepthFragment', targets: [{ format, writeMask: 0 }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        });
        const nodeTranslucentDepthPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'surfaceNodeTranslucentDepthFragment', targets: [{ format, writeMask: 0 }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        });
        const nodeTranslucentPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'surfaceNodeTranslucentFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'equal' },
        });
        const nodeRimPipeline = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'surfaceNodeRimFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
        });
        const nodePipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'nodeFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const mutedNodePipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'mutedNodeFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const matchedNodePipeline2D = await device.createRenderPipelineAsync({
            layout,
            vertex: { module, entryPoint: 'nodeVertex' },
            fragment: { module, entryPoint: 'matchedNodeFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const labelModule = device.createShaderModule({ code: LABEL_SHADER });
        const labelDiagnostics = await labelModule.getCompilationInfo();
        const labelErrors = labelDiagnostics.messages.filter(message => message.type === 'error');
        if (labelErrors.length) throw new Error(`Label WGSL compilation failed: ${labelErrors.map(error => error.message).join('; ')}`);
        const labelBuffer = device.createBuffer({
            size: MAX_LABEL_INSTANCES * 48,
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
            depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
        });
        const labelPipeline2D = await device.createRenderPipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [labelFrameBindGroupLayout, labelBindGroupLayout] }),
            vertex: { module: labelModule, entryPoint: 'labelVertex' },
            fragment: { module: labelModule, entryPoint: 'labelFragment', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-list' },
        });
        const cameraBuffer = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const gridPlaneBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const gridBindGroup = device.createBindGroup({ layout: gridLayout, entries: [
            { binding: 0, resource: { buffer: cameraBuffer } },
            { binding: 1, resource: { buffer: gridPlaneBuffer } },
        ] });
        const contextCameraBuffer = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const pathCameraBuffer = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const info = adapter.info;
        const adapterName = [info.vendor, info.architecture, info.device].filter(Boolean).join(' · ') || info.description || 'WebGPU adapter';
        return new WebGPUGraphRenderer(
            device, context, format, bindGroupLayout, labelFrameBindGroupLayout,
            cameraBuffer, contextCameraBuffer, pathCameraBuffer,
            contextCompositeLayout, contextCompositePipeline,
            gridPipeline, gridPipeline3D, gridBindGroup, gridPlaneBuffer, radiusPipeline,
            linePipeline, lineNoDepthWritePipeline, linePipeline2D,
            smoothPipeline, smoothNoDepthWritePipeline, smoothPipeline2D,
            loopPipeline, loopNoDepthWritePipeline, loopPipeline2D,
            arrowPipeline, arrowNoDepthWritePipeline, arrowPipeline2D,
            loopArrowPipeline, loopArrowNoDepthWritePipeline, loopArrowPipeline2D,
            nodePipeline, labelNodeDepthPipeline, nodeTranslucentDepthPipeline, nodeTranslucentPipeline, nodeRimPipeline,
            nodePipeline2D, mutedNodePipeline2D, matchedNodePipeline2D,
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
        const makeBindGroups = (cameraBuffer: GPUBuffer): [GPUBindGroup, GPUBindGroup] =>
            [nodeBuffer, alternateNodes].map(buffer => this.device.createBindGroup({ layout: this.bindGroupLayout, entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: { buffer: edgeBuffer } },
            { binding: 2, resource: { buffer: cameraBuffer } },
            { binding: 3, resource: { buffer: highlightBuffer } },
            { binding: 5, resource: { buffer: nodeColorBuffer } },
            { binding: 6, resource: { buffer: edgeColorBuffer } },
            { binding: 7, resource: { buffer: edgeWidthBuffer } },
            { binding: 8, resource: { buffer: arrowBuffer } },
        ] })) as [GPUBindGroup, GPUBindGroup];
        const bindGroups = makeBindGroups(this.cameraBuffer);
        const contextBindGroups = makeBindGroups(this.contextCameraBuffer);
        const pathBindGroups = makeBindGroups(this.pathCameraBuffer);
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
            nodeColorData, hasTranslucentNodes: hasTranslucentNodeColor(nodeColorData),
            selected: new Uint8Array(nodeCount),
            pinData, pinIndices: new Set(),
            flags, searchMask: new Uint8Array(nodeCount), hasSearchHighlights: false, activeSearch: null,
            bindGroups, contextBindGroups, pathBindGroups, labelFrameBindGroups, layout: null,
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
        this.device.queue.writeBuffer(this.gridPlaneBuffer, 0, gridPlaneBounds(nodes));
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
            graph.hasTranslucentNodes = hasTranslucentNodeColor(graph.nodeColorData);
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
        graph.hasSearchHighlights = graph.searchMask.some(value => value > 0);
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

    private getContextLayer(width: number, height: number): { view: GPUTextureView; bindGroup: GPUBindGroup } {
        if (this.contextTexture && this.contextView && this.contextBindGroup &&
            this.contextWidth === width && this.contextHeight === height) {
            return { view: this.contextView, bindGroup: this.contextBindGroup };
        }
        const previous = this.contextTexture;
        this.contextTexture = this.device.createTexture({
            size: [width, height], format: this.colorFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            label: 'faded graph context',
        });
        this.contextView = this.contextTexture.createView();
        this.contextBindGroup = this.device.createBindGroup({ layout: this.contextCompositeLayout, entries: [
            { binding: 0, resource: this.contextView },
        ] });
        this.contextWidth = width;
        this.contextHeight = height;
        if (previous) void this.device.queue.onSubmittedWorkDone().then(() => previous.destroy());
        return { view: this.contextView, bindGroup: this.contextBindGroup };
    }

    draw(camera: CameraState, edgeStyle: EdgeStyle, showNodes: boolean, outlineWidth: number, width: number, height: number, labels: LabelFrame | null, stepLayout: boolean | number = false, gridStep = 0, sceneBrightness = 1): FrameWork {
        const graph = this.graph;
        if (!graph || width < 1 || height < 1) return { cpuSubmitMs: 0, layoutEncodeMs: 0, layoutSteps: 0, drawCalls: 0, vertices: 0, layoutTick: false, layoutTicks: 0 };
        const showGrid = Number.isFinite(gridStep) && gridStep > 0;
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
        this.cameraWords[9] = this.focusNode === null ? 0 : 2;
        this.cameraData[10] = Number.isFinite(sceneBrightness) ? Math.min(2, Math.max(0.5, sceneBrightness)) : 1;
        this.cameraData[11] = showGrid ? gridStep : 1;
        const background = this.background as GPUColorDict;
        this.cameraData[12] = background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722 > 0.5 ? 1 : 0;
        this.cameraData.set([camera.distance, camera.referenceDistance, camera.pixelRatio ?? 1], 13);
        this.cameraData[16] = camera.centerZ ?? 0;
        this.cameraData[17] = graph.activeSearch !== null &&
            !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
            ? started * 0.001 : -1;
        this.cameraWords[18] = camera.projection === 'orthographic' ? 1 : 0;
        this.cameraWords[19] = camera.nodeStyle === 'simple' ? 0 : 1;
        const basis = cameraBasis(orientationForCamera(camera));
        this.cameraData.set(basis.right, 20);
        this.cameraData.set(basis.down, 24);
        this.cameraData.set(basis.toward, 28);
        this.device.queue.writeBuffer(this.cameraBuffer, 0, this.cameraData);
        if (this.focusNode !== null) {
            this.layerCameraData.set(this.cameraData);
            this.layerCameraWords[9] = 1;
            this.device.queue.writeBuffer(this.contextCameraBuffer, 0, this.layerCameraData);
            this.layerCameraWords[9] = 0;
            this.layerCameraWords[6] = 0xffffffff;
            this.device.queue.writeBuffer(this.pathCameraBuffer, 0, this.layerCameraData);
        }
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
        const colorView = this.context.getCurrentTexture().createView();
        let vertices = 0;
        let drawCalls = 0;
        const drawGrid = (target: GPURenderPassEncoder, spatial: boolean) => {
            if (!showGrid) return;
            target.setPipeline(spatial ? this.gridPipeline3D : this.gridPipeline);
            target.setBindGroup(0, this.gridBindGroup);
            target.draw(spatial ? 6 : 3);
            vertices += spatial ? 6 : 3;
            drawCalls++;
        };
        const drawEdges = (target: GPURenderPassEncoder, spatial: boolean, foreground: boolean): void => {
            const preservePathDepth = spatial && graph.foregroundEdges.length > 0;
            if (edgeStyle === 'thin') {
                target.setPipeline(spatial
                    ? preservePathDepth ? this.lineNoDepthWritePipeline : this.linePipeline
                    : this.linePipeline2D);
                target.draw(graph.loopStart * 2);
                vertices += graph.loopStart * 2;
            } else {
                target.setPipeline(spatial
                    ? preservePathDepth ? this.smoothNoDepthWritePipeline : this.smoothPipeline
                    : this.smoothPipeline2D);
                target.draw(6, graph.loopStart);
                vertices += graph.loopStart * 6;
            }
            drawCalls++;
            if (graph.loopStart < graph.edgeCount) {
                target.setPipeline(spatial
                    ? preservePathDepth ? this.loopNoDepthWritePipeline : this.loopPipeline
                    : this.loopPipeline2D);
                target.draw(144, graph.edgeCount - graph.loopStart, 0, graph.loopStart);
                vertices += (graph.edgeCount - graph.loopStart) * 144;
                drawCalls++;
            }
            if (foreground && graph.foregroundEdges.length) {
                // Analytics path edges retain their emphasis outside the hover
                // neighborhood without giving the faded context depth writes.
                if (this.focusNode !== null) target.setBindGroup(0, graph.pathBindGroups[graph.activeIndex]);
                target.setPipeline(spatial ? this.smoothPipeline : this.smoothPipeline2D);
                for (const index of graph.foregroundEdges) {
                    target.draw(6, 1, 0, index);
                    vertices += 6;
                    drawCalls++;
                }
                if (this.focusNode !== null) target.setBindGroup(0, graph.bindGroups[graph.activeIndex]);
            }
            if (graph.arrowCount) {
                target.setPipeline(spatial
                    ? preservePathDepth ? this.arrowNoDepthWritePipeline : this.arrowPipeline
                    : this.arrowPipeline2D);
                target.draw(3, graph.loopStart);
                vertices += graph.loopStart * 3;
                drawCalls++;
            }
            if (graph.loopArrowCount) {
                target.setPipeline(spatial
                    ? preservePathDepth ? this.loopArrowNoDepthWritePipeline : this.loopArrowPipeline
                    : this.loopArrowPipeline2D);
                target.draw(3, graph.edgeCount - graph.loopStart, 0, graph.loopStart);
                vertices += (graph.edgeCount - graph.loopStart) * 3;
                drawCalls++;
            }
        };
        if (this.focusNode !== null) {
            // Composite the faint scene separately so many overlapping links
            // cannot build an opaque wash or write depth over the neighborhood.
            const contextLayer = this.getContextLayer(width, height);
            const contextPass = encoder.beginRenderPass({ colorAttachments: [{
                view: contextLayer.view,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear', storeOp: 'store',
            }] });
            contextPass.setBindGroup(0, graph.contextBindGroups[graph.activeIndex]);
            drawEdges(contextPass, false, false);
            if (showNodes) {
                contextPass.setPipeline(this.nodePipeline2D);
                contextPass.draw(6, graph.nodeCount);
                vertices += graph.nodeCount * 6;
                drawCalls++;
            }
            contextPass.end();

            const compositePass = encoder.beginRenderPass({ colorAttachments: [{
                view: colorView, clearValue: this.background, loadOp: 'clear', storeOp: 'store',
            }] });
            if (!camera.mode3d) drawGrid(compositePass, false);
            compositePass.setPipeline(this.contextCompositePipeline);
            compositePass.setBindGroup(0, contextLayer.bindGroup);
            compositePass.draw(3);
            compositePass.end();
            vertices += 3;
            drawCalls++;
        }
        // In a dense 2D view, individually translucent non-matches can stack
        // into an opaque blanket. Accumulate them once and cap their combined
        // alpha before drawing matched nodes at their normal opacity.
        const isolateMutedNodes2D = !camera.mode3d && showNodes &&
            graph.hasSearchHighlights && graph.hasTranslucentNodes;
        const mutedNodeLayer = isolateMutedNodes2D ? this.getContextLayer(width, height) : null;
        if (mutedNodeLayer) {
            const mutedPass = encoder.beginRenderPass({ colorAttachments: [{
                view: mutedNodeLayer.view,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear', storeOp: 'store',
            }] });
            mutedPass.setBindGroup(0, graph.bindGroups[graph.activeIndex]);
            mutedPass.setPipeline(this.mutedNodePipeline2D);
            mutedPass.draw(6, graph.nodeCount);
            mutedPass.end();
            vertices += graph.nodeCount * 6;
            drawCalls++;
        }
        const passDescriptor: GPURenderPassDescriptor = { colorAttachments: [{
            view: colorView,
            clearValue: this.background,
            loadOp: this.focusNode === null ? 'clear' : 'load',
            storeOp: 'store',
        }] };
        const depthView = camera.mode3d ? this.getDepthTexture(width, height).createView() : null;
        if (depthView) passDescriptor.depthStencilAttachment = {
            view: depthView,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
        };
        const pass = encoder.beginRenderPass(passDescriptor);
        if (this.focusNode === null && !camera.mode3d) drawGrid(pass, false);
        pass.setBindGroup(0, graph.bindGroups[graph.activeIndex]);
        const drawTranslucentNodes = camera.mode3d && showNodes && graph.hasTranslucentNodes;
        if (camera.mode3d && showNodes) {
            // Opaque surfaces establish depth for links and later translucent
            // nodes. A muted node must not hide a link before it can blend.
            pass.setPipeline(this.nodePipeline);
            pass.draw(6, graph.nodeCount);
            vertices += graph.nodeCount * 6;
            drawCalls++;
        }
        drawEdges(pass, camera.mode3d, true);
        // The 3D grid is a real world plane. Draw it before translucent nodes
        // so their color also blends over grid lines behind them.
        if (camera.mode3d && showGrid) {
            drawGrid(pass, true);
            if (showNodes) pass.setBindGroup(0, graph.bindGroups[graph.activeIndex]);
        }
        if (drawTranslucentNodes) {
            // First select the nearest muted surface against opaque nodes and
            // links. Its color then blends over geometry behind it, while a
            // nearer link or node still wins the depth test.
            pass.setPipeline(this.nodeTranslucentDepthPipeline);
            pass.draw(6, graph.nodeCount);
            vertices += graph.nodeCount * 6;
            drawCalls++;
            pass.setPipeline(this.nodeTranslucentPipeline);
            pass.draw(6, graph.nodeCount);
            vertices += graph.nodeCount * 6;
            drawCalls++;
        }
        if (camera.mode3d && showNodes) {
            // Rims also follow depth: a nearer muted rim remains translucent
            // over a link; a farther rim cannot cover the nearer link.
            pass.setPipeline(this.nodeRimPipeline);
            pass.draw(6, graph.nodeCount);
            vertices += graph.nodeCount * 6;
            drawCalls++;
        }
        const drawLabels = (target: GPURenderPassEncoder, spatial: boolean,
            plates = true, glyphs = true): void => {
            if (!labels?.glyphCount) return;
            target.setPipeline(spatial ? this.labelPipeline : this.labelPipeline2D);
            target.setBindGroup(0, graph.labelFrameBindGroups[graph.activeIndex]);
            target.setBindGroup(1, this.labelBindGroup);
            if (plates && labels.plateCount) {
                target.draw(6, labels.plateCount, 0, labels.glyphCount);
                vertices += labels.plateCount * 6;
                drawCalls++;
            }
            if (glyphs) {
                target.draw(6, labels.glyphCount);
                vertices += labels.glyphCount * 6;
                drawCalls++;
            }
        };
        if (!camera.mode3d && labels?.underlay) drawLabels(pass, false, true, false);
        if (mutedNodeLayer) {
            pass.setPipeline(this.contextCompositePipeline);
            pass.setBindGroup(0, mutedNodeLayer.bindGroup);
            pass.draw(3);
            vertices += 3;
            drawCalls++;
        }
        if (showNodes && !camera.mode3d) {
            pass.setBindGroup(0, graph.bindGroups[graph.activeIndex]);
            pass.setPipeline(mutedNodeLayer ? this.matchedNodePipeline2D : this.nodePipeline2D);
            pass.draw(6, graph.nodeCount);
            vertices += graph.nodeCount * 6;
            drawCalls++;
        }
        if (!camera.mode3d) drawLabels(pass, false, !labels?.underlay, true);
        pass.end();
        if (camera.mode3d && labels?.glyphCount && depthView) {
            // Edges retain their depth writes for graph geometry. Rebuild only
            // node surface depth before labels so transparent links cannot
            // reject text fragments, while nearer nodes can still hide them.
            const labelPass = encoder.beginRenderPass({
                colorAttachments: [{ view: colorView, loadOp: 'load', storeOp: 'store' }],
                depthStencilAttachment: { view: depthView, depthClearValue: 1,
                    depthLoadOp: 'clear', depthStoreOp: 'discard' },
            });
            if (showNodes) {
                labelPass.setPipeline(this.labelNodeDepthPipeline);
                labelPass.setBindGroup(0, graph.bindGroups[graph.activeIndex]);
                labelPass.draw(6, graph.nodeCount);
                vertices += graph.nodeCount * 6;
                drawCalls++;
            }
            drawLabels(labelPass, true);
            labelPass.end();
        }
        this.device.queue.submit([encoder.finish()]);
        return { cpuSubmitMs: performance.now() - started, layoutEncodeMs, layoutSteps,
            drawCalls, vertices,
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
        this.gridPlaneBuffer.destroy();
        this.contextTexture?.destroy();
        this.cameraBuffer.destroy();
        this.contextCameraBuffer.destroy();
        this.pathCameraBuffer.destroy();
        this.labelBuffer.destroy();
        this.labelAtlas.destroy();
        this.context.unconfigure();
        this.device.destroy();
    }
}
