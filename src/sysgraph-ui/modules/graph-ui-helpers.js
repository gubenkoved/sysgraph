/**
 * Helper functions available in node label expressions
 * (nodeLabelMode === 'expression').
 *
 * Add new helpers here to make them accessible in the expression context.
 * All exported names from `labelHelpers` are injected into the evaluation
 * scope alongside the node's own properties via `with`.
 */

/**
 * Converts a byte count to a human-readable string.
 * - Below 1 KiB  → "XXX B"
 * - Below 1 MiB  → "XXX KiB"
 * - Otherwise    → "XXX MiB"
 * - Non-number / undefined / NaN → "N/A"
 * @param {number} bytes
 * @returns {string}
 */
export function bytes_to_human(bytes) {
    if (bytes === undefined || bytes === null || typeof bytes !== 'number' || isNaN(bytes)) return 'N/A';
    const KiB = 1024;
    const MiB = 1024 * KiB;
    if (bytes < KiB) return `${bytes} B`;
    if (bytes < MiB) return `${(bytes / KiB).toFixed(1)} KiB`;
    return `${(bytes / MiB).toFixed(1)} MiB`;
}

/**
 * All label helpers, keyed by name, injected into expression scope.
 * @type {Record<string, Function>}
 */
export const labelHelpers = {
    bytes_to_human,
};
