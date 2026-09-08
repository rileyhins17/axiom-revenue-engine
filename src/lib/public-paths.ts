const PUBLIC_PATH_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/offline",
  "/api/auth",
  "/api/agent",
  "/_next",
  "/favicon.ico",
];

const PUBLIC_EXACT_PATHS = new Set([
  "/api/mcp",
  "/install",
  "/api/internal/cron-tick",
  "/api/ios-profile",
]);

export function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
