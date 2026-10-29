import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import { getPrisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type ArchiveMode = "active" | "archived" | "all";

function parseArchiveMode(value: string | null): ArchiveMode {
  if (value === "archived" || value === "all") return value;
  return "active";
}

function archiveWhereClause(mode: ArchiveMode) {
  if (mode === "archived") return "COALESCE(isArchived, 0) = 1";
  if (mode === "all") return "1 = 1";
  return "COALESCE(isArchived, 0) = 0";
}

const latestQualificationJoin = `
  LEFT JOIN (
    SELECT
      q1."leadId" AS "qualificationLeadId",
      q1."totalScore" AS "qualificationTotalScore",
      q1."websiteNeedScore" AS "qualificationWebsiteNeedScore",
      q1."businessFitScore" AS "qualificationBusinessFitScore",
      q1."reachabilityScore" AS "qualificationReachabilityScore",
      q1."timingScore" AS "qualificationTimingScore",
      q1."hardGateStatus" AS "qualificationHardGateStatus",
      q1."band" AS "qualificationBand",
      q1."recommendedChannel" AS "qualificationRecommendedChannel",
      q1."autonomousEmailEligible" AS "qualificationAutonomousEmailEligible",
      q1."reasonCodesJson" AS "qualificationReasonCodesJson",
      q1."evidenceJson" AS "qualificationEvidenceJson",
      q1."policyVersion" AS "qualificationPolicyVersion",
      q1."createdAt" AS "qualificationCreatedAt"
    FROM "QualificationSnapshot" q1
    WHERE q1."id" = (
      SELECT q2."id"
      FROM "QualificationSnapshot" q2
      WHERE q2."leadId" = q1."leadId"
      ORDER BY q2."createdAt" DESC, q2."id" DESC
      LIMIT 1
    )
  ) quality ON quality."qualificationLeadId" = "Lead"."id"`;

const qualificationSelect = `
  quality."qualificationTotalScore",
  quality."qualificationWebsiteNeedScore",
  quality."qualificationBusinessFitScore",
  quality."qualificationReachabilityScore",
  quality."qualificationTimingScore",
  quality."qualificationHardGateStatus",
  quality."qualificationBand",
  quality."qualificationRecommendedChannel",
  quality."qualificationAutonomousEmailEligible",
  quality."qualificationReasonCodesJson",
  quality."qualificationEvidenceJson",
  quality."qualificationPolicyVersion",
  quality."qualificationCreatedAt"`;

export async function GET(request: Request) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim();
  const archiveMode = parseArchiveMode(url.searchParams.get("archive"));
  const archiveWhere = archiveWhereClause(archiveMode);
  const limitParam = url.searchParams.get("limit");
  // Hard cap response size so the Worker does not OOM on 2k+ row payloads.
  // VaultDataTable now paginates client-side, so 1000 covers the visible page
  // (max 100/page * a buffer) without dumping the entire 8k+ lead table.
  const DEFAULT_LIMIT = 1000;
  const MAX_LIMIT = 5000;
  const limit = limitParam
    ? Math.min(Math.max(1, Number(limitParam) || DEFAULT_LIMIT), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const db = getDatabase();
  const countsRow = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(isArchived, 0) = 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN COALESCE(isArchived, 0) = 1 THEN 1 ELSE 0 END) AS archived
       FROM "Lead"`,
    )
    .first<{ total: number; active: number; archived: number }>();

  if (search && search.length >= 2) {
    const pattern = `%${search}%`;
    const stmt = db.prepare(
      `SELECT id, businessName, niche, city, category, address, phone, email,
              socialLink, websiteUrl, websiteDomain, rating, reviewCount, websiteStatus,
              contactName, tacticalNote, outreachStatus, outreachChannel,
              firstContactedAt, lastContactedAt, nextFollowUpDue, outreachNotes,
              axiomScore, axiomTier, disqualifyReason, emailType, emailConfidence,
              isArchived, createdAt,
              ${qualificationSelect}
       FROM "Lead"
       ${latestQualificationJoin}
       WHERE ${archiveWhere}
         AND ("businessName" LIKE ?1 OR "email" LIKE ?1 OR "city" LIKE ?1 OR "niche" LIKE ?1 OR "contactName" LIKE ?1)
       ORDER BY createdAt DESC
       LIMIT ?2`,
    ).bind(pattern, limit ?? 100);
    const result = await stmt.all<Record<string, unknown>>();
    return NextResponse.json({
      leads: result.results ?? [],
      counts: {
        total: countsRow?.total ?? 0,
        active: countsRow?.active ?? 0,
        archived: countsRow?.archived ?? 0,
      },
      archiveMode,
    });
  }

  const query = `SELECT id, businessName, niche, city, category, address, phone, email,
              socialLink, websiteUrl, websiteDomain, rating, reviewCount, websiteStatus,
              contactName, tacticalNote, outreachStatus, outreachChannel,
              firstContactedAt, lastContactedAt, nextFollowUpDue, outreachNotes,
              axiomScore, axiomTier, disqualifyReason, emailType, emailConfidence,
              isArchived, createdAt,
              ${qualificationSelect}
       FROM "Lead"
       ${latestQualificationJoin}
       WHERE ${archiveWhere}
       ORDER BY createdAt DESC
       LIMIT ${limit}`;

  const result = await db.prepare(query).all<Record<string, unknown>>();
  return NextResponse.json({
    leads: result.results ?? [],
    counts: {
      total: countsRow?.total ?? 0,
      active: countsRow?.active ?? 0,
      archived: countsRow?.archived ?? 0,
    },
    archiveMode,
  });
}

export async function POST(request: Request) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  const body = await request.json();
  const { businessName, niche, city, email, phone, contactName, websiteUrl, category, address, tacticalNote } = body as Record<string, string | null>;

  if (!businessName?.trim() || !niche?.trim() || !city?.trim()) {
    return NextResponse.json(
      { error: "businessName, niche, and city are required" },
      { status: 400 }
    );
  }

  const prisma = getPrisma();
  const lead = await prisma.lead.create({
    data: {
      businessName: businessName.trim(),
      niche: niche.trim(),
      city: city.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      contactName: contactName?.trim() || null,
      websiteUrl: websiteUrl?.trim() || null,
      category: category?.trim() || null,
      address: address?.trim() || null,
      tacticalNote: tacticalNote?.trim() || null,
      source: "manual",
      axiomTier: "C",
      axiomScore: 0,
      leadScore: 0,
      isArchived: false,
    },
  });

  return NextResponse.json({ lead }, { status: 201 });
}
