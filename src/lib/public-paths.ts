const PUBLIC_PATH_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/offline",
  "/api/auth",
  "/api/agent",
  "/api/mcp",
  "/_next",
  "/favicon.ico",
];

const PUBLIC_EXACT_PATHS = new Set([
  "/install",
  "/api/internal/cron-tick",
  "/api/ios-profile",
  "/unsubscribe",
  "/api/unsubscribe",
]);

export function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
