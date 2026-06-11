import {
    SHARE_HASH_KEY,
    SHARE_MAX_DECODED_BYTES,
    SHARE_MAX_URL_BYTES,
    SHARE_VERSION,
} from './constants.js';
import { type LoadedGraphData, parseGraphData } from './data-io.js';

/**
 * How a shared graph carries view settings (the `display` block):
 * - `none` — strip any display block
 * - `current` — embed a snapshot of the live view settings
 * - `embedded` — keep the graph's own embedded display block as-is
 */
export type ShareDisplayMode = 'none' | 'current' | 'embedded';

/** Result of encoding a graph into a shareable URL. */
export interface ShareEncodeResult {
    /** Full shareable URL on the current domain (graph lives in the hash). */
    url: string;
    /** Byte length of the URL. */
    bytes: number;
    /** True when the URL exceeds the safely shareable size. */
    tooLarge: boolean;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Gzips a byte buffer using the browser's native CompressionStream. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    void writer.write(bytes as BufferSource);
    void writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
}

/**
 * Gunzips a byte buffer, aborting if the decompressed output exceeds maxBytes
 * (decompression-bomb guard for untrusted links).
 */
async function gunzipCapped(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    void writer.write(bytes as BufferSource);
    void writer.close();

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error('data URL is too large to decode');
        }
        chunks.push(value);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

/** Encodes bytes to URL-safe base64 (no padding). */
function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes URL-safe base64 back to bytes. */
function fromBase64Url(value: string): Uint8Array {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Serializes graph data, compresses it, and builds a shareable URL on the
 * current domain with the payload in the hash fragment.
 */
export async function encodeGraphToShareUrl(data: unknown): Promise<ShareEncodeResult> {
    const json = JSON.stringify(data);
    const compressed = await gzip(textEncoder.encode(json));
    const payload = SHARE_VERSION + toBase64Url(compressed);

    const { origin, pathname } = window.location;
    const url = `${origin}${pathname}#${SHARE_HASH_KEY}=${payload}`;
    const bytes = textEncoder.encode(url).length;

    return { url, bytes, tooLarge: bytes > SHARE_MAX_URL_BYTES };
}

/**
 * Reads a shared-graph payload from a URL hash fragment and decodes it back
 * into graph data. Returns null when the hash carries no shared graph; throws
 * on a malformed or unsupported payload.
 */
export async function decodeShareFromHash(hash: string): Promise<LoadedGraphData | null> {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!raw) return null;

    const prefix = `${SHARE_HASH_KEY}=`;
    let payload: string | null = null;
    for (const part of raw.split('&')) {
        if (part.startsWith(prefix)) {
            payload = part.slice(prefix.length);
            break;
        }
    }
    if (!payload) return null;

    const version = payload[0];
    if (version !== SHARE_VERSION) {
        throw new Error(`unsupported data URL version "${version}"`);
    }

    const compressed = fromBase64Url(payload.slice(1));
    const decoded = await gunzipCapped(compressed, SHARE_MAX_DECODED_BYTES);
    return parseGraphData(textDecoder.decode(decoded));
}

/**
 * Removes the shared-graph hash from the address bar without adding a history
 * entry, so the (potentially huge) URL never lingers in browsing history.
 */
export function stripShareHash(): void {
    const { origin, pathname, search } = window.location;
    history.replaceState(null, '', `${origin}${pathname}${search}`);
}
