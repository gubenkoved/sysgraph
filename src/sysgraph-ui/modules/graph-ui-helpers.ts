/**
 * Helper functions available in node label expressions
 * (nodeLabelMode === 'expression').
 */

/**
 * Converts a byte count to a human-readable string.
 */
export function bytes_to_human(bytes: number): string {
    if (bytes === undefined || bytes === null || typeof bytes !== 'number' || Number.isNaN(bytes)) return 'N/A';
    const KiB = 1024;
    const MiB = 1024 * KiB;
    if (bytes < KiB) return `${bytes} B`;
    if (bytes < MiB) return `${(bytes / KiB).toFixed(1)} KiB`;
    return `${(bytes / MiB).toFixed(1)} MiB`;
}

/**
 * All label helpers, keyed by name, injected into expression scope.
 */
export const labelHelpers: Record<string, (...args: unknown[]) => unknown> = {
    bytes_to_human: bytes_to_human as (...args: unknown[]) => unknown,
};
