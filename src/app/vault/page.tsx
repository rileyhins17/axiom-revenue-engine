import { Database } from "lucide-react";

import VaultDataTable from "@/components/VaultDataTable";
import { PageHeader } from "@/components/ui/page-header";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  await requireSession();

  const db = getDatabase();
  const [
    totalRow,
    readyRow,
    verifiedRow,
    missingRow,
    emailRow,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM "Lead" WHERE COALESCE(isArchived, 0) = 0`).first<{ c: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM "Lead" WHERE outreachStatus = 'READY_FOR_FIRST_TOUCH' AND COALESCE(isArchived, 0) = 0`,
      )
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM "Lead" WHERE websiteStatus = 'ACTIVE' AND COALESCE(isArchived, 0) = 0`,
      )
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM "Lead" WHERE websiteStatus = 'MISSING' AND COALESCE(isArchived, 0) = 0`,
      )
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM "Lead" WHERE email IS NOT NULL AND email != '' AND COALESCE(isArchived, 0) = 0`,
      )
      .first<{ c: number }>(),
  ]);

  const total = totalRow?.c ?? 0;
  const readyForTouch = readyRow?.c ?? 0;
  const verifiedWebsite = verifiedRow?.c ?? 0;
  const missingWebsite = missingRow?.c ?? 0;
  const withEmail = emailRow?.c ?? 0;

  const metrics = [
    {
      label: "Records",
      value: total.toLocaleString(),
      detail: "active records",
      tone: "default" as const,
    },
    {
      label: "Pre-send",
      value: readyForTouch.toLocaleString(),
      detail: `${readyForTouch.toLocaleString()} ready`,
      tone: "info" as const,
    },
    {
      label: "Verified",
      value: verifiedWebsite.toLocaleString(),
      detail: missingWebsite > 0 ? `${missingWebsite.toLocaleString()} no site` : "all sites checked",
      tone: "positive" as const,
    },
    {
      label: "Exportable",
      value: withEmail.toLocaleString(),
      detail: `${withEmail.toLocaleString()} with email`,
      tone: "warning" as const,
    },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader
        eyebrow="Lead intelligence"
        title="Vault"
        description="Review qualified leads, resolve data gaps, and prepare clean records for outreach."
        icon={Database}
        metrics={metrics}
      />

      <VaultDataTable totalCount={total} />
    </div>
  );
}
