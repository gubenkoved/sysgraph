/**
 * @typedef {[string, number]} ColorStop
 * A tuple of [cssColor, position] where position is in [0, 1].
 */

/**
 * Parses a CSS color string into {r, g, b} components.
 * Supports hex (#rgb, #rrggbb), rgb(), and rgba() formats.
 * @param {string} css
 * @returns {{ r: number, g: number, b: number }}
 */
function parseCssColor(css) {
    const s = css.trim();

    // hex
    if (s.startsWith('#')) {
        let hex = s.slice(1);
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
        };
    }

    // rgb() or rgba()
    const match = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
        return { r: +match[1], g: +match[2], b: +match[3] };
    }

    throw new Error(`Cannot parse color: ${css}`);
}

/**
 * Linearly interpolates between two values.
 * @param {number} a
 * @param {number} b
 * @param {number} t - Interpolation factor in [0, 1].
 * @returns {number}
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * A color scale that maps values in [0, 1] to interpolated CSS colors.
 *
 * Accepts an array of color stops — tuples of [cssColor, position] where
 * position is a value from 0 to 1 pinpointing where that color sits on the
 * spectrum.  Colors between stops are linearly interpolated in RGB space.
 *
 * @example
 * const scale = new ColorScale([
 *     ['#ff0000', 0],    // red at 0
 *     ['#ff8800', 0.5],  // orange at 0.5
 *     ['#ffff00', 1],    // yellow at 1
 * ]);
 * scale.getColor(0);    // 'rgb(255, 0, 0)'
 * scale.getColor(0.25); // 'rgb(255, 68, 0)'  (interpolated)
 * scale.getColor(1);    // 'rgb(255, 255, 0)'
 */
export class ColorScale {
    /**
     * @param {ColorStop[]} stops - At least two [cssColor, position] tuples,
     *   sorted by position ascending. Positions must be in [0, 1].
     */
    constructor(stops) {
        if (stops.length < 2) {
            throw new Error('ColorScale requires at least two stops');
        }

        this.stops = stops
            .slice()
            .sort((a, b) => a[1] - b[1])
            .map(([css, pos]) => ({ color: parseCssColor(css), pos }));
    }

    /**
     * Returns an interpolated CSS rgb() color for the given value.
     * Values outside [0, 1] are clamped.
     * @param {number} value - A value in [0, 1].
     * @returns {string} CSS rgb() color string.
     */
    getColor(value) {
        const t = Math.max(0, Math.min(1, value));

        // exact or beyond edges
        if (t <= this.stops[0].pos) {
            const { r, g, b } = this.stops[0].color;
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        }
        if (t >= this.stops[this.stops.length - 1].pos) {
            const { r, g, b } = this.stops[this.stops.length - 1].color;
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        }

        // find the two surrounding stops
        for (let i = 0; i < this.stops.length - 1; i++) {
            const lo = this.stops[i];
            const hi = this.stops[i + 1];

            if (t >= lo.pos && t <= hi.pos) {
                const segmentT = (t - lo.pos) / (hi.pos - lo.pos);
                const r = Math.round(lerp(lo.color.r, hi.color.r, segmentT));
                const g = Math.round(lerp(lo.color.g, hi.color.g, segmentT));
                const b = Math.round(lerp(lo.color.b, hi.color.b, segmentT));
                return `rgb(${r}, ${g}, ${b})`;
            }
        }

        // fallback (should not reach here)
        const { r, g, b } = this.stops[0].color;
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }
}
