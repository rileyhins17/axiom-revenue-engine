/** Intentionally ignores credentials and request bodies. No operational imports. */
export function retiredLegacyControlResponse(): Response {
  return new Response(null, {
    status: 410,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
