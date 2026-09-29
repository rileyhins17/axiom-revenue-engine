/** Re-mounts on every navigation, so each page rises in. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="owner-page-enter">{children}</div>;
}
