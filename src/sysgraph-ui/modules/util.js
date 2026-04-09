/**
 * Computes the FNV-1a 32-bit hash of a string.
 * @param {string} str
 * @returns {number} Unsigned 32-bit hash value.
 */
export function fnv1a(str) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0; // unsigned
}
