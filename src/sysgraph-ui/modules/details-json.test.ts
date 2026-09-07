import { describe, expect, it } from 'vitest';
import { parseJsonContainerString } from './details-json.js';

describe('parseJsonContainerString', () => {
    it('recognizes objects and arrays, including whitespace and empty containers', () => {
        expect(parseJsonContainerString(' \n {"leafs": [{"name": "rack"}]} \t '))
            .toEqual({ leafs: [{ name: 'rack' }] });
        expect(parseJsonContainerString('[1, "two", null]')).toEqual([1, 'two', null]);
        expect(parseJsonContainerString('{}')).toEqual({});
        expect(parseJsonContainerString('[]')).toEqual([]);
    });

    it.each(['', 'plain text', '123', 'true', 'false', 'null', '"text"', '"{}"'])
        ('leaves primitive strings unchanged: %s', value => {
            expect(parseJsonContainerString(value)).toBeNull();
        });

    it.each(['{not json}', '[broken]', '{"key":1,}', '[1,]', '{} trailing'])
        ('leaves malformed JSON unchanged: %s', value => {
            expect(parseJsonContainerString(value)).toBeNull();
        });

    it.each([null, undefined, 123, false, { leafs: [] }, [1, 2]])
        ('does not convert non-string values: %j', value => {
            expect(parseJsonContainerString(value)).toBeNull();
        });

    it('preserves the original string and treats HTML and special keys as data', () => {
        const properties = Object.freeze({
            rack_type_json: '{"__proto__":{"name":"rack"},"label":"<img src=x onerror=alert(1)>"}',
        });
        const original = properties.rack_type_json;
        const parsed = parseJsonContainerString(original);
        expect(parsed).toEqual(JSON.parse(original));
        expect(Object.keys(parsed as object)).toContain('__proto__');
        expect(properties.rack_type_json).toBe(original);
    });
});