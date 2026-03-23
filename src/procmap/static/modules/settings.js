export const settings = {
    d3Charge: -400,
    d3LinkDistance: 140,
    d3LinkStrength: 0.8,
    d3CollisionMultiplier: 1.0,
    d3AlphaTarget: 0.0,
    d3VelocityDecay: 0.80,
    d3ForceXYStrength: 0.1,
    d3CenterForce: true,

    showIsolated: true,
    // curvature interval per each link when there are multiple
    curvatureStep: 0.005,

    nodeColors: {},
    edgeColors: {},
};

export const linkOpacity = 0.5;

export const defaultNodeColor = { r: 40, g: 40, b: 40, a: 1.0 };
export const defaultEdgeColor = { r: 40, g: 40, b: 40, a: linkOpacity };

// alpha multipler for distances 0, 1, 2, 3 (and more)
export const highlightAlphaMultipliers = [1.0, 1.0, 0.5, 0.1]

export const perTypeDefaultColors = {
    nodes: {
        process: { r: 21, g: 127, b: 200, a: 1.0 },
        socket: { r: 220, g: 75, b: 47, a: 1.0 },
        pipe: { r: 169, g: 57, b: 249, a: 1.0 },
        external_ip: { r: 255, g: 103, b: 0, a: 1.0 },
    },
    edges: {
        unix_domain_socket: { r: 31, g: 120, b: 180, a: linkOpacity },
        pipe: { r: 207, g: 110, b: 255, a: linkOpacity },
        socket_connection: { r: 255, g: 76, b: 40, a: linkOpacity },
        socket: { r: 255, g: 76, b: 40, a: linkOpacity },
        child_process: { r: 40, g: 40, b: 40, a: linkOpacity },
    }
}
