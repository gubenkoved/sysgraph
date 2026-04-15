/** A tuple of [cssColor, position] where position is in [0, 1]. */
export type ColorStop = [string, number];

interface ParsedColor {
    r: number;
    g: number;
    b: number;
}

interface ParsedStop {
    color: ParsedColor;
    pos: number;
}

/**
 * Parses a CSS color string into {r, g, b} components.
 * Supports hex (#rgb, #rrggbb), rgb(), and rgba() formats.
 */
function parseCssColor(css: string): ParsedColor {
    const s = css.trim();

    // hex
    if (s.startsWith('#')) {
        let hex = s.slice(1);
        if (hex.length === 3) {
            hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
        }
        return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16),
        };
    }

    // rgb() or rgba()
    const match = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
        return { r: +match[1]!, g: +match[2]!, b: +match[3]! };
    }

    throw new Error(`Cannot parse color: ${css}`);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * A color scale that maps values in [0, 1] to interpolated CSS colors.
 *
 * Accepts an array of color stops — tuples of [cssColor, position] where
 * position is a value from 0 to 1 pinpointing where that color sits on the
 * spectrum.  Colors between stops are linearly interpolated in RGB space.
 */
export class ColorScale {
    private readonly stops: ParsedStop[];

    constructor(stops: ColorStop[]) {
        if (stops.length < 2) {
            throw new Error('ColorScale requires at least two stops');
        }

        this.stops = stops
            .slice()
            .sort((a, b) => a[1] - b[1])
            .map(([css, pos]) => ({ color: parseCssColor(css), pos }));
    }

    /**
     * Returns a CSS `rgb(…)` string for the given value in [0, 1].
     * Values outside [0, 1] are clamped to the nearest stop.
     */
    getColor(value: number): string {
        const clamped = Math.max(this.stops[0]!.pos, Math.min(this.stops[this.stops.length - 1]!.pos, value));

        // find the two surrounding stops
        let lo = this.stops[0]!;
        let hi = this.stops[this.stops.length - 1]!;

        for (let i = 0; i < this.stops.length - 1; i++) {
            if (clamped <= this.stops[i + 1]!.pos) {
                lo = this.stops[i]!;
                hi = this.stops[i + 1]!;
                break;
            }
        }

        const range = hi.pos - lo.pos;
        const t = range === 0 ? 0 : (clamped - lo.pos) / range;

        const r = Math.round(lerp(lo.color.r, hi.color.r, t));
        const g = Math.round(lerp(lo.color.g, hi.color.g, t));
        const b = Math.round(lerp(lo.color.b, hi.color.b, t));

        return `rgb(${r}, ${g}, ${b})`;
    }
}
