export interface CameraCenterTransition {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    fromZ?: number;
    toZ?: number;
    startedAt: number;
    durationMs: number;
}

/** Smoothly pans between camera centers without changing zoom or orbit angle. */
export function cameraCenterAt(transition: CameraCenterTransition, now: number): { x: number; y: number; z?: number; done: boolean } {
    const t = Math.max(0, Math.min(1, (now - transition.startedAt) / transition.durationMs));
    const eased = t * t * (3 - 2 * t);
    const z = transition.fromZ !== undefined && transition.toZ !== undefined
        ? { z: transition.fromZ + (transition.toZ - transition.fromZ) * eased }
        : {};
    return {
        x: transition.fromX + (transition.toX - transition.fromX) * eased,
        y: transition.fromY + (transition.toY - transition.fromY) * eased,
        ...z,
        done: t >= 1,
    };
}
