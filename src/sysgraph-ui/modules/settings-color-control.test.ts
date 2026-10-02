import { describe, expect, it } from 'vitest';
import { hsvToRgb, parseHex, rgbToHsv } from './settings-color-control.js';

describe('settings color picker conversions', () => {
    it('round trips RGB colors through hue, saturation, and brightness', () => {
        for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [255, 103, 0], [21, 87, 200], [54, 188, 123]]) {
            const hsv = rgbToHsv({ r: r!, g: g!, b: b!, a: 0.4 });
            expect(hsvToRgb(hsv)).toEqual({ r, g, b });
        }
    });

    it('accepts short and full hex values and rejects malformed values', () => {
        expect(parseHex('#f70')).toEqual({ r: 255, g: 119, b: 0 });
        expect(parseHex('157fc8')).toEqual({ r: 21, g: 127, b: 200 });
        expect(parseHex('#12zz34')).toBeNull();
    });
});
