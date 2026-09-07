export function parseJsonContainerString(value: unknown): Record<string, unknown> | unknown[] | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
        return JSON.parse(trimmed) as Record<string, unknown> | unknown[];
    } catch {
        return null;
    }
}