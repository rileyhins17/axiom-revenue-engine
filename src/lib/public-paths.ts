const PUBLIC_PATH_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/offline",
  "/api/auth",
  "/_next",
  "/favicon.ico",
];

const PUBLIC_EXACT_PATHS = new Set([
  "/api/mcp",
  "/api/agent/jobs/claim",
  "/install",
  "/api/internal/cron-tick",
  "/api/ios-profile",
]);

export function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) ||
    /^\/api\/agent\/jobs\/[^/]+\/(complete|failed|heartbeat|logs|results)$/.test(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
