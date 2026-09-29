/** Canonical payload bytes shared by Caller, Revenue Engine and Orbit (v2). */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) {
        const items: string[] = [];
        for (let i = 0; i < value.length; i++) {
            if (!Object.hasOwn(value, i)) throw new Error('Sparse arrays are not canonical JSON');
            items.push(canonicalJson(value[i]));
        }
        return '[' + items.join(',') + ']';
    }
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const record = value as Record<string, unknown>;
        return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
    }
    throw new Error('Unsupported canonical JSON value');
}

export async function resultPayloadHash(actorId: string, workspaceId: string, event: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalJson({ actorId, workspaceId, event }));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
