import { describe, expect, it } from 'vitest';

// share.ts transitively imports data-io -> context-menu, which touches
// `document` at module-load time, and encodeGraphToShareUrl reads
// window.location. provide minimal stubs so the module imports and runs in the
// default node environment (no jsdom dependency). stubs must be in place before
// the dynamic import below, which is why a static import is not used here.
const g = globalThis as unknown as Record<string, unknown>;
g.document = { getElementById: () => null };
g.window = { location: { origin: 'https://example.com', pathname: '/app' } };

const { encodeGraphToShareUrl, decodeShareFromHash } = await import('./share.js');

/** Pulls the hash fragment out of a generated share URL. */
function hashOf(url: string): string {
    return new URL(url).hash;
}

describe('share encode/decode round-trip', () => {
    it('restores nodes and edges', async () => {
        const data = {
            nodes: [
                { id: 'a', type: 'process', properties: { name: 'bash' } },
                { id: 'b', type: 'process', properties: { name: 'vim' } },
            ],
            edges: [
                { id: 'e1', source_id: 'a', target_id: 'b', type: 'child_process', properties: {} },
            ],
        };

        const result = await encodeGraphToShareUrl(data);
        expect(result.tooLarge).toBe(false);
        expect(result.url.startsWith('https://example.com/app#share=')).toBe(true);

        const loaded = await decodeShareFromHash(hashOf(result.url));
        expect(loaded).not.toBeNull();
        expect(loaded!.nodes).toHaveLength(2);
        expect(loaded!.edges).toHaveLength(1);
        expect(loaded!.nodes.map(n => n.id).sort()).toEqual(['a', 'b']);
        expect(loaded!.edges[0]).toMatchObject({ source_id: 'a', target_id: 'b', type: 'child_process' });
    });

    it('round-trips an embedded display block', async () => {
        const data = {
            display: { d3Charge: -42, nodeColors: { process: '#ff0000' } },
            nodes: [{ id: 'a', type: 'process', properties: {} }],
            edges: [],
        };

        const result = await encodeGraphToShareUrl(data);
        const loaded = await decodeShareFromHash(hashOf(result.url));
        expect(loaded!.display).toEqual({ d3Charge: -42, nodeColors: { process: '#ff0000' } });
    });
});

describe('decodeShareFromHash', () => {
    it('returns null when the hash carries no shared graph', async () => {
        expect(await decodeShareFromHash('')).toBeNull();
        expect(await decodeShareFromHash('#')).toBeNull();
        expect(await decodeShareFromHash('#other=1')).toBeNull();
    });

    it('throws on an unsupported payload version', async () => {
        await expect(decodeShareFromHash('#share=9abc')).rejects.toThrow(/unsupported data URL version/);
    });
});

describe('size cap', () => {
    it('flags an oversized graph as tooLarge', async () => {
        // high-entropy labels resist compression, so a large graph reliably
        // exceeds the shareable URL size cap
        const nodes = Array.from({ length: 4000 }, (_, i) => ({
            id: `n${i}`,
            type: 'process',
            properties: { label: Math.random().toString(36) + Math.random().toString(36) },
        }));
        const result = await encodeGraphToShareUrl({ nodes, edges: [] });
        expect(result.tooLarge).toBe(true);
    });
});
