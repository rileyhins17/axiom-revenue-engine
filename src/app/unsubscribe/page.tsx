import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe | Axiom Web", robots: { index: false } };

/** Public unsubscribe page. GET only shows a button, so link scanners cannot unsubscribe people. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t, done } = await searchParams;
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-white px-6 text-slate-900">
    <h1 className="text-2xl font-semibold">Axiom Web emails</h1>
    {done === "1" ? <p>You&apos;re unsubscribed. We won&apos;t email you again.</p>
      : done === "0" ? <p>That link wasn&apos;t recognised. Reply to our email with &ldquo;unsubscribe&rdquo; and we&apos;ll remove you by hand.</p>
      : t ? <form method="post" action="/api/unsubscribe" className="space-y-3">
          <input type="hidden" name="t" value={t} />
          <p>Click below and we&apos;ll never email you again.</p>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Unsubscribe</button>
        </form>
      : <p>Reply to any of our emails with &ldquo;unsubscribe&rdquo; and we&apos;ll remove you.</p>}
    <p className="text-xs text-slate-600">Axiom Web, 257 Kipling Ave, Kitchener, ON N2C 2B9</p>
  </main>;
}
