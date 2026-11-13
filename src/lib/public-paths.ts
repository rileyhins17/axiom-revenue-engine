const PUBLIC_PATH_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/offline",
  "/api/auth",
  "/_next",
  "/favicon.ico",
  // The Claude connector's link form, /api/mcp/k/<key>: it checks its own key, not the sign-in cookie.
  "/api/mcp/",
];

const PUBLIC_EXACT_PATHS = new Set([
  "/install",
  "/api/ios-profile",
  "/api/health",
  // The Claude connector (src/lib/connector/mcp-http.ts): its own key, in the Authorization header.
  "/api/mcp",
]);

export function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
