const PUBLIC_PATH_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/offline",
  "/api/auth",
  "/_next",
  "/favicon.ico",
];

const PUBLIC_EXACT_PATHS = new Set([
  "/install",
  "/api/ios-profile",
  "/api/health",
]);

export function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
