/** A world-anchored grid. The 3D plane is projected with the graph camera. */
export const GRID_SHADER = /* wgsl */ `
struct Camera {
    center: vec2f,
    scale: f32,
    stroke: f32,
    viewport: vec2f,
    focusNode: u32,
    outlineWidth: f32,
    mode3d: u32,
    renderLayer: u32,
    reserved0: f32,
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

@group(0) @binding(0) var<uniform> camera: Camera;

struct GridPlane {
    center: vec2f,
    halfSize: vec2f,
}

@group(0) @binding(1) var<uniform> plane: GridPlane;

@vertex fn gridVertex(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(positions[vertex], 0.0, 1.0);
}

struct GridPlaneVertex {
    @builtin(position) position: vec4f,
    @location(0) world: vec2f,
}

@vertex fn gridPlaneVertex(@builtin(vertex_index) vertex: u32) -> GridPlaneVertex {
    let corners = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
    let world = plane.center + corners[vertex] * plane.halfSize;
    let relative = vec3f(world - camera.center, -camera.centerZ);
    let rotated = vec3f(dot(camera.right.xyz, relative), dot(camera.down.xyz, relative),
        dot(camera.toward.xyz, relative));
    var out: GridPlaneVertex;
    if (camera.orthographic == 1u) {
        out.position = vec4f(rotated.x * camera.scale * 2.0 / camera.viewport.x,
            -rotated.y * camera.scale * 2.0 / camera.viewport.y,
            clamp(0.5 - rotated.z / (camera.referenceDistance * 4.0), 0.0, 1.0), 1.0);
    } else {
        let near = max(0.000001, min(camera.referenceDistance * 0.05, camera.distance * 0.1));
        let eyeDistance = camera.distance - rotated.z;
        // Homogeneous clipping handles the horizon and near plane. A fixed
        // world quad never changes its line phase or footprint with the camera.
        out.position = vec4f(rotated.x * camera.scale * camera.referenceDistance * 2.0 / camera.viewport.x,
            -rotated.y * camera.scale * camera.referenceDistance * 2.0 / camera.viewport.y,
            eyeDistance - near, eyeDistance);
    }
    out.world = world;
    return out;
}

fn lineCoverage(cells: vec2f, footprint: vec2f, halfWidth: f32) -> f32 {
    let distancePx = abs(fract(cells + vec2f(0.5)) - vec2f(0.5)) / footprint;
    let x = 1.0 - smoothstep(halfWidth, halfWidth + 0.9, distancePx.x);
    let y = 1.0 - smoothstep(halfWidth, halfWidth + 0.9, distancePx.y);
    // Fade a line family before its spacing becomes too small to sample.
    let periodPx = vec2f(1.0) / footprint;
    let visible = smoothstep(vec2f(8.0 * camera.pixelRatio),
        vec2f(20.0 * camera.pixelRatio), periodPx);
    return max(x * visible.x, y * visible.y);
}

fn gridOpacity(world: vec2f) -> f32 {
    let cells = world / max(camera.gridStep, 0.0001);
    // Derivatives are evaluated on every fragment, including misses near the
    // horizon. The caller applies visibility masks only after this function.
    let footprint = max(fwidth(cells), vec2f(0.00001));
    let minor = lineCoverage(cells, footprint, 0.38 * camera.pixelRatio);
    let major = lineCoverage(cells / 5.0, footprint / 5.0, 0.58 * camera.pixelRatio);
    let light = camera.lightTheme > 0.5;
    let minorAlpha = select(0.09, 0.075, light);
    let majorAlpha = select(0.14, 0.13, light);
    return max(minor * minorAlpha, major * majorAlpha);
}

fn gridColor() -> vec3f {
    let light = camera.lightTheme > 0.5;
    return select(vec3f(0.43, 0.58, 0.76), vec3f(0.34, 0.42, 0.55), light);
}

@fragment fn gridFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let halfViewport = camera.viewport * 0.5;
    let flatWorld = camera.center + (position.xy - halfViewport) / max(camera.scale, 0.00001);
    return vec4f(gridColor(), gridOpacity(flatWorld));
}

@fragment fn gridPlaneFragment(in: GridPlaneVertex) -> @location(0) vec4f {
    let grid = gridOpacity(in.world);
    // Feather only the fixed plane boundary. Visibility no longer changes at
    // a camera-dependent ray distance or angle threshold.
    let edgeDistance = min(plane.halfSize.x - abs(in.world.x - plane.center.x),
        plane.halfSize.y - abs(in.world.y - plane.center.y));
    let fade = smoothstep(0.0, min(plane.halfSize.x, plane.halfSize.y) * 0.12, edgeDistance);
    return vec4f(gridColor(), grid * fade);
}
`;
