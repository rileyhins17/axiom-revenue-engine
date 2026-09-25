/**
 * Shown instantly while a page loads (via each route's loading.tsx), so a click
 * never lands on a blank screen. Gold shimmer in the ivory theme.
 */
export function RouteSkeleton({ label }: { label?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6" aria-busy="true">
      <header className="space-y-2">
        <div className="owner-skeleton h-3 w-40" />
        <div className="owner-skeleton h-9 w-72" />
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="owner-skeleton h-44 lg:col-span-2" />
        <div className="grid gap-4">
          <div className="owner-skeleton h-20" />
          <div className="owner-skeleton h-20" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="owner-skeleton h-36" />
        <div className="owner-skeleton h-36" />
      </div>
      <div className="owner-skeleton h-64" />
      <span className="sr-only">Loading {label ?? "page"}…</span>
    </div>
  );
}
