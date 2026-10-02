/** CSS-pixel bounds shared by drawing, hit testing, labels and edge decorations. */
export const MIN_NODE_SCREEN_RADIUS = 0.6;
export const MAX_NODE_SCREEN_RADIUS = 192;

export function screenNodeRadius(worldRadius: number, scale: number, perspectiveFactor = 1,
    maxRadius = MAX_NODE_SCREEN_RADIUS): number {
    return Math.max(MIN_NODE_SCREEN_RADIUS,
        Math.min(maxRadius, Math.abs(worldRadius) * scale * perspectiveFactor));
}
