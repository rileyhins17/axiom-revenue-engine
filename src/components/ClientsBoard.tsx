"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Building2,
  Calendar,
  Clock,
  CopyIcon,
  DollarSign,
  Download,
  ExternalLink,
  Globe,
  Mail,
  MessageSquare,
  MoreHorizontalIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  SearchIcon,
  Trash2Icon,
  UserIcon,
  X,
} from "lucide-react";

import {
  CLIENT_PRIORITY_OPTIONS,
  DEAL_HEALTH_META,
  DEAL_KANBAN_COLUMNS,
  DEAL_STAGE_OPTIONS,
  ENGAGEMENT_TYPE_OPTIONS,
  computeDealHealth,
  getDealStageMeta,
  getDaysUntilRenewal,
  getEngagementTypeLabel,
  isActionOverdue,
  type DealStage,
} from "@/lib/crm";
import type { LeadRecord } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddClientDialog } from "@/components/clients/add-client-dialog";
import { useToast } from "@/components/ui/toast-provider";

type CrmLead = LeadRecord;

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function formatDueDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  if (date < today) {
    const days = Math.ceil((today.getTime() - date.getTime()) / 86400000);
    return days === 1 ? "Yesterday" : `${days}d overdue`;
  }
  if (date < tomorrow) return "Today";
  const days = Math.ceil((date.getTime() - today.getTime()) / 86400000);
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `${days}d`;
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function formatCompactMoney(value: number) {
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `$${value.toLocaleString()}`;
}

function defaultDueDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

function toInputDate(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toTime(d: Date | string | null | undefined) {
  if (!d) return 0;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

// ---------- Deal Card ----------

function DealCard({
  lead,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  lead: CrmLead;
  onEdit: (lead: CrmLead) => void;
  onDelete?: (lead: CrmLead) => void;
  onDragStart?: (e: React.DragEvent, leadId: number) => void;
  onDragEnd?: () => void;
}) {
  const router = useRouter();
  const stageMeta = getDealStageMeta(lead.dealStage);
  const daysUntilRenewal = getDaysUntilRenewal(lead.renewalDate);
  const renewalWarning = daysUntilRenewal !== null && daysUntilRenewal <= 30;
  const overdue = isActionOverdue(lead.nextActionDueAt);
  const health = lead.dealStage ? computeDealHealth(lead) : null;
  const healthMeta = health ? DEAL_HEALTH_META[health] : null;

  return (
    <article
      draggable={Boolean(onDragStart)}
      onDragStart={(e) => onDragStart?.(e, lead.id)}
      onDragEnd={() => onDragEnd?.()}
      className="group relative w-full rounded-2xl border border-[#e1e9de] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#c7d8c5] hover:shadow-md md:cursor-grab md:active:cursor-grabbing"
    >
      <button
        type="button"
        aria-label={`Edit ${lead.businessName}`}
        onClick={() => onEdit(lead)}
        className="v2-focus-ring absolute inset-0 rounded-xl"
      />
      <div className="pointer-events-none relative">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#263a2f] truncate leading-tight">
            {lead.businessName}
          </div>
          <div className="text-xs text-[#64766a] truncate mt-1">
            {lead.city} · {lead.niche}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {healthMeta && health !== "WON" && health !== "LOST" && (
            <span className={cn(
              "inline-flex items-center rounded-md border border-[#d7e2d3] bg-[#edf3eb] px-2 py-1 text-[10px] font-semibold text-[#405b48]",
            )}>
              {healthMeta.label}
            </span>
          )}
          <div className="pointer-events-auto relative z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${lead.businessName}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex size-8 items-center justify-center rounded-lg text-[#53675a] transition-colors hover:bg-[#e8efe6] hover:text-[#24382d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] cursor-pointer"
              >
                <MoreHorizontalIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); router.push(`/clients/${lead.id}` as Route); }}>
                <UserIcon className="size-3.5" />
                View Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(lead); }}>
                <Pencil className="size-3.5" />
                Edit Deal
              </DropdownMenuItem>
              {lead.email && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(lead.email!); }}>
                  <CopyIcon className="size-3.5" />
                  Copy Email
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onDelete?.(lead); }}>
                <Trash2Icon className="size-3.5" />
                Remove from Board
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </div>

      {lead.engagementType && (
        <div className="text-xs font-medium text-[#526457] mb-1.5">
          {getEngagementTypeLabel(lead.engagementType)}
        </div>
      )}

      {/* Next action */}
      {lead.nextAction && (
        <div className="flex items-start gap-1 mb-1.5">
          {overdue ? (
            <Clock className="size-3 text-[#9b2f2f] shrink-0 mt-px" />
          ) : (
            <Clock className="size-3 text-[#5b6d5f] shrink-0 mt-px" />
          )}
          <div className="min-w-0">
            <span className={cn(
              "text-xs truncate block",
              overdue ? "text-[#9b2f2f]" : "text-[#526457]",
            )}>
              {lead.nextAction}
            </span>
            {lead.nextActionDueAt && (
              <span className={cn(
                "text-[11px] font-medium",
                overdue ? "text-[#9b2f2f]" : "text-[#5b6d5f]",
              )}>
                {formatDueDate(lead.nextActionDueAt)}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-0.5">
        {lead.monthlyValue ? (
          <span className="font-mono text-xs font-semibold text-[#285d3d]" title="Recorded monthly estimate; not confirmed cash received">
            ~${lead.monthlyValue.toLocaleString()}/mo
          </span>
        ) : (
          <span className="font-mono text-xs text-[#5b6d5f]">No monthly estimate</span>
        )}
        {renewalWarning && (
          <span className="flex items-center gap-1 text-[11px] text-[#755312] font-semibold">
            <AlertCircle className="size-3" />
            {daysUntilRenewal === 0 ? "Today" : `${daysUntilRenewal}d`}
          </span>
        )}
      </div>

      {lead.outreachStatus === "REPLIED" && !lead.dealStage && (
        <div className="mt-2 text-xs text-[#17657a] font-medium flex items-center gap-1">
          <MessageSquare className="size-3" />
          Replied — needs stage
        </div>
      )}

      {stageMeta && !lead.dealStage && (
        <div className={cn("mt-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium", stageMeta.classes)}>
          {stageMeta.shortLabel}
        </div>
      )}
      </div>
    </article>
  );
}

// ---------- Kanban Column ----------

function KanbanColumn({
  stage,
  label,
  description,
  leads,
  onEdit,
  onDelete,
  onAddFromInbox,
  onDragStart,
  onDragEnd,
  onDrop,
  isDragOver,
  onDragOver,
  onDragLeave,
}: {
  stage: DealStage;
  label: string;
  description: string;
  leads: CrmLead[];
  onEdit: (lead: CrmLead) => void;
  onDelete?: (lead: CrmLead) => void;
  onAddFromInbox?: () => void;
  onDragStart?: (e: React.DragEvent, leadId: number) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent, stage: DealStage) => void;
  isDragOver?: boolean;
  onDragOver?: (e: React.DragEvent, stage: DealStage) => void;
  onDragLeave?: () => void;
}) {
  const columnMrr = leads.reduce((s, l) => s + (l.monthlyValue ?? 0), 0);

  return (
    <section aria-label={`${label} stage`} className="flex flex-col min-w-[250px] w-[250px] shrink-0">
      <div className="flex items-center justify-between gap-2 mb-3 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#263a2f]">{label}</h2>
            {leads.length > 0 && (
              <span className="font-mono text-xs text-[#526457] border border-[#dfe7dd] bg-white rounded-md px-2 py-1">
                {leads.length}
              </span>
            )}
          </div>
          <div className="text-xs text-[#64766a] mt-1">{description}</div>
        </div>
        {columnMrr > 0 && (
          <span className="font-mono text-xs font-medium text-[#285d3d] shrink-0" title="Sum of entered monthly estimates">
            ~${columnMrr.toLocaleString()}/mo
          </span>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); onDragOver?.(e, stage); }}
        onDragLeave={() => onDragLeave?.()}
        onDrop={(e) => { e.preventDefault(); onDrop?.(e, stage); }}
        className={cn(
          "flex-1 rounded-2xl border border-[#e0e8dc] p-2.5 flex flex-col gap-2 min-h-[150px] transition-colors",
          isDragOver
            ? "border-emerald-500/40 bg-[#edf4ec]"
            : "bg-[#f1f5ef]",
        )}
      >
        {leads.map((lead) => (
          <DealCard key={lead.id} lead={lead} onEdit={onEdit} onDelete={onDelete} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        ))}
        {leads.length === 0 && !isDragOver && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-xs text-[#5b6d5f]">No items in this stage</span>
          </div>
        )}
        {isDragOver && (
          <div className="flex-1 flex items-center justify-center border-2 border-dashed border-[#176443]/45 rounded-xl bg-white/70">
            <span className="text-xs text-[#176443] font-semibold">Drop here</span>
          </div>
        )}
        {onAddFromInbox && leads.length === 0 && !isDragOver && (
          <button
            type="button"
            onClick={onAddFromInbox}
            className="mt-1 min-h-10 flex items-center gap-1.5 text-xs font-medium text-[#53675a] hover:text-[#24382d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] transition-colors cursor-pointer"
          >
            <Plus className="size-3" />
            Add from inbox
          </button>
        )}
      </div>
    </section>
  );
}

function MobileStageSection({
  label,
  description,
  leads,
  onEdit,
  onDelete,
}: {
  label: string;
  description: string;
  leads: CrmLead[];
  onEdit: (lead: CrmLead) => void;
  onDelete?: (lead: CrmLead) => void;
}) {
  return (
    <section className="rounded-2xl border border-[#e0e8dc] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#263a2f]">{label}</h2>
          <p className="mt-1 text-xs text-[#64766a]">{description}</p>
        </div>
        <span className="rounded-md border border-[#dfe7dd] bg-[#f6f8f3] px-2 py-1 font-mono text-xs text-[#526457]">
          {leads.length}
        </span>
      </div>
      <div className="space-y-2">
        {leads.length ? (
          leads.map((lead) => (
            <DealCard key={lead.id} lead={lead} onEdit={onEdit} onDelete={onDelete} />
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-[#dfe7dd] bg-[#f6f8f3] px-3 py-6 text-center text-xs text-[#5b6d5f]">
            No clients in this stage yet
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- Deal Drawer ----------

function DealDrawer({
  lead,
  onClose,
  onSave,
  onRemove,
  saving,
}: {
  lead: CrmLead;
  onClose: () => void;
  onSave: (leadId: number, update: Record<string, unknown>) => Promise<boolean>;
  onRemove: (lead: CrmLead) => void;
  saving: boolean;
}) {
  const [dealStage, setDealStage] = useState<string>(lead.dealStage ?? "");
  const [engagementType, setEngagementType] = useState<string>(lead.engagementType ?? "");
  const [monthlyValue, setMonthlyValue] = useState<string>(lead.monthlyValue ? String(lead.monthlyValue) : "");
  const [proposalValue, setProposalValue] = useState<string>(lead.proposalValue ? String(lead.proposalValue) : "");
  const [proposalStatus, setProposalStatus] = useState<string>(lead.proposalStatus ?? "");
  const [packageRecommendation, setPackageRecommendation] = useState<string>(lead.packageRecommendation ?? "");
  const [clientPriority, setClientPriority] = useState<string>(lead.clientPriority ?? "");
  const [nextAction, setNextAction] = useState<string>(lead.nextAction ?? "");
  const [nextActionDueAt, setNextActionDueAt] = useState<string>(toInputDate(lead.nextActionDueAt));
  const [dealLostReason, setDealLostReason] = useState<string>(lead.dealLostReason ?? "");
  const [projectStartDate, setProjectStartDate] = useState<string>(toInputDate(lead.projectStartDate));
  const [launchTargetDate, setLaunchTargetDate] = useState<string>(toInputDate(lead.launchTargetDate));
  const [projectOwner, setProjectOwner] = useState<string>(lead.projectOwner ?? "");
  const [renewalDate, setRenewalDate] = useState<string>(toInputDate(lead.renewalDate));
  const [proposalSentAt, setProposalSentAt] = useState<string>(toInputDate(lead.proposalSentAt));
  const [signedAt, setSignedAt] = useState<string>(toInputDate(lead.signedAt));
  const [projectNotes, setProjectNotes] = useState<string>(lead.projectNotes ?? "");

  const handleDealStageChange = (nextStage: string) => {
    const today = new Date().toISOString().slice(0, 10);
    setDealStage(nextStage);
    if (nextStage === "PROPOSAL_SENT" && !proposalSentAt) {
      setProposalSentAt(today);
    }
    if (nextStage === "SIGNED" && !signedAt) {
      setSignedAt(today);
    }
  };

  const handleSave = async () => {
    await onSave(lead.id, {
      dealStage: dealStage || null,
      engagementType: engagementType || null,
      monthlyValue: monthlyValue ? Number(monthlyValue) : null,
      proposalValue: proposalValue ? Number(proposalValue) : null,
      proposalStatus: proposalStatus || null,
      packageRecommendation: packageRecommendation || null,
      clientPriority: clientPriority || null,
      nextAction: nextAction || null,
      nextActionDueAt: nextActionDueAt || null,
      dealLostReason: dealLostReason || null,
      projectStartDate: projectStartDate || null,
      launchTargetDate: launchTargetDate || null,
      projectOwner: projectOwner || null,
      renewalDate: renewalDate || null,
      proposalSentAt: proposalSentAt || null,
      signedAt: signedAt || null,
      projectNotes: projectNotes || null,
    });
  };

  const daysUntilRenewal = getDaysUntilRenewal(renewalDate || null);
  const isLost = dealStage === "LOST";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative flex h-[100dvh] w-full flex-col overflow-y-auto bg-[#f6f8f3] shadow-2xl animate-in slide-in-from-bottom duration-200 sm:max-w-md sm:border-l sm:border-[#dfe7dd] sm:slide-in-from-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#e3e9e0] px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#263a2f] truncate">{lead.businessName}</h2>
            <p className="text-xs text-[#64766a] mt-0.5">{lead.city} · {lead.niche}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${lead.businessName} deal editor`}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-[#53675a] hover:bg-[#e8efe6] hover:text-[#24382d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Contact info */}
        <div className="flex flex-col gap-1.5 border-b border-[#e3e9e0] px-4 py-3 sm:px-6">
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="flex items-center gap-2 text-xs text-[#526457] hover:text-[#263a2f] transition-colors"
            >
              <Mail className="size-3.5 shrink-0 text-[#5b6d5f]" />
              {lead.email}
            </a>
          )}
          {lead.websiteUrl && (
            <a
              href={lead.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-[#526457] hover:text-[#263a2f] transition-colors"
            >
              <Globe className="size-3.5 shrink-0 text-[#5b6d5f]" />
              {lead.websiteDomain ?? lead.websiteUrl}
              <ExternalLink className="size-3 text-[#5b6d5f]" />
            </a>
          )}
        </div>

        {/* Deal fields */}
        <div className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6">

          {/* Stage + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Stage
              </label>
              <select
                value={dealStage}
                onChange={(e) => handleDealStageChange(e.target.value)}
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-2.5 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] cursor-pointer"
              >
                <option value="">— None —</option>
                {DEAL_STAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Priority
              </label>
              <select
                value={clientPriority}
                onChange={(e) => setClientPriority(e.target.value)}
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-2.5 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] cursor-pointer"
              >
                <option value="">— None —</option>
                {CLIENT_PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Engagement Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
              Engagement Type
            </label>
            <select
              value={engagementType}
              onChange={(e) => setEngagementType(e.target.value)}
              className="w-full rounded-lg border border-[#dfe7dd] bg-white px-3 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] cursor-pointer"
            >
              <option value="">— Select type —</option>
              {ENGAGEMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Monthly Value */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Project Value
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#64766a] pointer-events-none" />
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={proposalValue}
                  onChange={(e) => setProposalValue(e.target.value)}
                  placeholder="3500"
                  className="w-full rounded-lg border border-[#dfe7dd] bg-white pl-8 pr-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443]"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Monthly Value
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#64766a] pointer-events-none" />
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={monthlyValue}
                  onChange={(e) => setMonthlyValue(e.target.value)}
                  placeholder="150"
                  className="w-full rounded-lg border border-[#dfe7dd] bg-white pl-8 pr-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443]"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Proposal Status
              </label>
              <input
                type="text"
                value={proposalStatus}
                onChange={(e) => setProposalStatus(e.target.value)}
                placeholder="draft / sent / accepted"
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Package
              </label>
              <input
                type="text"
                value={packageRecommendation}
                onChange={(e) => setPackageRecommendation(e.target.value)}
                placeholder="Rebuild + care"
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443]"
              />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#e3e9e0]" />

          {/* Next Action */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
              Next Action
            </label>
            <input
              type="text"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="e.g. Follow up on proposal"
              className="w-full rounded-lg border border-[#dfe7dd] bg-white px-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443]"
            />
          </div>

          {/* Next Action Due */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
              Due Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#64766a] pointer-events-none" />
              <input
                type="date"
                value={nextActionDueAt}
                onChange={(e) => setNextActionDueAt(e.target.value)}
                className="w-full rounded-lg border border-[#dfe7dd] bg-white pl-8 pr-3 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] [color-scheme:light]"
              />
            </div>
          </div>

          {/* Lost reason — only when stage is LOST */}
          {isLost && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Lost Reason
              </label>
              <input
                type="text"
                value={dealLostReason}
                onChange={(e) => setDealLostReason(e.target.value)}
                placeholder="e.g. Budget, went with competitor…"
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9b2f2f]"
              />
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-[#e3e9e0]" />

          {/* Proposal Sent / Signed dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Proposal Sent
              </label>
              <input
                type="date"
                value={proposalSentAt}
                onChange={(e) => setProposalSentAt(e.target.value)}
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-2.5 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] [color-scheme:light]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Signed
              </label>
              <input
                type="date"
                value={signedAt}
                onChange={(e) => setSignedAt(e.target.value)}
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-2.5 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] [color-scheme:light]"
              />
            </div>
          </div>

          {/* Project Start / Launch dates */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Project Start
              </label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#64766a] pointer-events-none" />
                <input
                  type="date"
                  value={projectStartDate}
                  onChange={(e) => setProjectStartDate(e.target.value)}
                  className="w-full rounded-lg border border-[#dfe7dd] bg-white pl-7 pr-2 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] [color-scheme:light]"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Launch Target
              </label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#64766a] pointer-events-none" />
                <input
                  type="date"
                  value={launchTargetDate}
                  onChange={(e) => setLaunchTargetDate(e.target.value)}
                  className="w-full rounded-lg border border-[#dfe7dd] bg-white pl-7 pr-2 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] [color-scheme:light]"
                />
              </div>
            </div>
          </div>

          {/* Owner / Renewal */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Project Owner
              </label>
              <input
                type="text"
                value={projectOwner}
                onChange={(e) => setProjectOwner(e.target.value)}
                placeholder="Aidan / Riley"
                className="w-full rounded-lg border border-[#dfe7dd] bg-white px-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
                Renewal
              </label>
              <div className="relative">
                <RefreshCw className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#64766a] pointer-events-none" />
                <input
                  type="date"
                  value={renewalDate}
                  onChange={(e) => setRenewalDate(e.target.value)}
                  className="w-full rounded-lg border border-[#dfe7dd] bg-white pl-7 pr-2 py-2 text-sm text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443] [color-scheme:light]"
                />
              </div>
              {daysUntilRenewal !== null && (
                <p className={cn(
                  "text-[11px] flex items-center gap-1",
                  daysUntilRenewal <= 0 ? "text-[#9b2f2f]" : daysUntilRenewal <= 30 ? "text-[#755312]" : "text-[#64766a]",
                )}>
                  <AlertCircle className="size-3" />
                  {daysUntilRenewal <= 0 ? "Overdue" : daysUntilRenewal === 1 ? "Tomorrow" : `In ${daysUntilRenewal}d`}
                </p>
              )}
            </div>
          </div>

          {/* Project Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10.5px] uppercase tracking-[0.15em] text-[#64766a] font-semibold">
              Notes
            </label>
            <textarea
              value={projectNotes}
              onChange={(e) => setProjectNotes(e.target.value)}
              rows={3}
              placeholder="Scope, deliverables, special requirements…"
              className="w-full rounded-lg border border-[#dfe7dd] bg-white px-3 py-2 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] resize-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#176443]"
            />
          </div>

          {/* TODO: Activity timeline — log calls, emails, stage changes per lead */}
          {/* TODO: Client profile route — /clients/[id] with full context */}
          {/* TODO: Proposal builder — attach a proposal draft / link */}
          {/* TODO: Discovery notes — structured intake from first call */}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-[#e3e9e0] bg-[#f6f8f3]/96 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 backdrop-blur sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <div className="text-[10.5px] text-[#5b6d5f]">
                {lead.firstContactedAt ? `First contact ${formatDate(lead.firstContactedAt)}` : "Not yet contacted"}
              </div>
              <Link
                href={`/clients/${lead.id}` as Route}
              className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-[#285d3d] transition-colors hover:text-[#1d4c30] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]"
              >
                Open full profile
                <ExternalLink className="size-3" />
              </Link>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#b7cdb8] bg-[#e7f0e5] px-4 py-2 text-sm font-semibold text-[#285d3d] transition-all hover:border-[#8eaf91] hover:bg-[#dcebd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto cursor-pointer"
            >
              <Save className="size-3.5" />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => { onClose(); onRemove(lead); }}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#e5c4bf] bg-[#fff4f2] px-3 py-2 text-xs font-semibold text-[#9b2f2f] transition hover:border-[#d58d86] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b2f2f] cursor-pointer"
          >
            <Trash2Icon className="size-3.5" />
            Remove from Board
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Inbox (replied / interested, no stage yet) ----------

function InboxSection({
  leads,
  onEdit,
  onQuickUpdate,
  onDismiss,
  onReset,
  saving,
}: {
  leads: CrmLead[];
  onEdit: (lead: CrmLead) => void;
  onQuickUpdate: (leadId: number, update: Record<string, unknown>) => Promise<boolean>;
  onDismiss: (leadId: number) => Promise<void>;
  onReset: () => Promise<void>;
  saving: boolean;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (leads.length === 0) return null;

  const handleReset = async () => {
    setResetting(true);
    await onReset();
    setResetting(false);
    setConfirmReset(false);
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  return (
      <section aria-labelledby="client-replies-heading" className="mb-6 rounded-2xl border border-[#dce8dc] bg-[#edf4ec] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MessageSquare className="size-4 text-[#17657a]" aria-hidden="true" />
        <h2 id="client-replies-heading" className="text-sm font-semibold text-[#263a2f]">Replies to review</h2>
        <span className="font-mono text-[10px] text-[#64766a] border border-[#dfe7dd] bg-[#f4f7f1] rounded px-1 py-0.5">
          {leads.length}
        </span>
        <span className="basis-full text-xs leading-5 text-[#526457] sm:basis-auto">Replied or interested — move to a stage to track</span>
        <div className="ml-auto flex items-center gap-2">
          {confirmReset ? (
            <>
              <span className="flex items-center gap-1 text-[11px] text-[#755312]">
                <AlertCircle className="size-3" />
                Reset all {leads.length} inbox leads?
              </span>
              <button
                type="button"
                disabled={resetting}
                onClick={() => void handleReset()}
                className="min-h-9 rounded-lg px-3 py-1 text-xs font-semibold text-[#9b2f2f] border border-[#e3b9b4] bg-white hover:bg-[#fff4f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b2f2f] transition disabled:opacity-50 cursor-pointer"
              >
                {resetting ? "Resetting…" : "Yes, reset"}
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => setConfirmReset(false)}
                className="min-h-9 rounded-lg px-3 py-1 text-xs font-medium text-[#526457] border border-[#dfe7dd] bg-white hover:bg-[#f1f5ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] transition disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex min-h-9 items-center gap-1 rounded-lg bg-white px-3 py-1 text-xs font-medium text-[#526457] border border-[#dfe7dd] hover:border-[#c2d2c1] hover:text-[#24382d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] transition cursor-pointer"
            >
              <RefreshCw className="size-3" />
              Reset inbox
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {leads.map((lead) => (
          <div
            key={lead.id}
            className="group/card rounded-xl border border-[#d5e4e3] bg-white px-4 py-4 shadow-sm transition hover:border-[#a8c9c6] hover:shadow-md"
          >
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => onEdit(lead)}
                className="group flex min-w-0 flex-1 items-start gap-2.5 text-left cursor-pointer"
              >
                <Building2 className="mt-0.5 size-4 shrink-0 text-[#17657a]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[#263a2f]">{lead.businessName}</div>
                  <div className="mt-1 truncate text-xs text-[#64766a]">{lead.city} / {lead.niche}</div>
                  {lead.email && (
                    <div className="mt-1 truncate text-xs text-[#5b6d5f]">{lead.email}</div>
                  )}
                </div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`More actions for ${lead.businessName}`}
                    className="shrink-0 inline-flex size-9 items-center justify-center rounded-lg text-[#53675a] transition-colors hover:bg-[#e8efe6] hover:text-[#24382d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] cursor-pointer"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(lead)}>
                    <Pencil className="size-3.5" />
                    Edit Deal
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/clients/${lead.id}` as Route}>
                      <UserIcon className="size-3.5" />
                      View Profile
                    </Link>
                  </DropdownMenuItem>
                  {lead.email && (
                    <DropdownMenuItem onClick={() => copyToClipboard(lead.email!)}>
                      <CopyIcon className="size-3.5" />
                      Copy Email
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void onDismiss(lead.id)}
                  >
                    <X className="size-3.5" />
                    Dismiss from Inbox
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void onQuickUpdate(lead.id, {
                    dealStage: "DISCOVERY_BOOKED",
                    nextAction: "Schedule 30-minute discovery call",
                    nextActionDueAt: defaultDueDate(1),
                  })
                }
                className="min-h-9 rounded-lg border border-[#dfe7dd] bg-[#f6f8f3] px-3 py-1.5 text-xs font-semibold text-[#526457] transition hover:border-[#d5b898] hover:bg-[#fff7ee] hover:text-[#755312] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              >
                → Discovery
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onQuickUpdate(lead.id, { dealStage: "PROPOSAL_SENT" })}
                className="min-h-9 rounded-lg border border-[#dfe7dd] bg-[#f6f8f3] px-3 py-1.5 text-xs font-semibold text-[#526457] transition hover:border-[#d5b898] hover:bg-[#fff7ee] hover:text-[#755312] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              >
                → Proposal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void onQuickUpdate(lead.id, {
                    dealStage: "LOST",
                    dealLostReason: "Not qualified from CRM inbox",
                  })
                }
                className="min-h-9 rounded-lg border border-[#dfe7dd] bg-[#f6f8f3] px-3 py-1.5 text-xs font-medium text-[#526457] transition hover:border-[#e3b9b4] hover:bg-[#fff4f2] hover:text-[#9b2f2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              >
                ✕ Lost
              </button>
            </div>
          </div>
        ))}
      </div>
      </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail,
  tone = "zinc",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail: string;
  tone?: "emerald" | "amber" | "cyan" | "red" | "zinc";
}) {
  const toneClasses = {
    emerald: "text-[#285d3d]",
    amber: "text-[#755312]",
    cyan: "text-[#17657a]",
    red: "text-[#9b2f2f]",
    zinc: "text-[#314538]",
  }[tone];

  return (
    <div className="min-w-0 rounded-xl border border-[#e1e5dc] bg-white px-4 py-3">
      <div className="mb-1 flex min-h-7 items-center gap-2 text-xs font-semibold leading-5 text-[#526457]">
        {icon}
        {label}
      </div>
      <div className={cn("text-xl font-semibold tabular-nums tracking-tight", toneClasses)}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-[#64766a]">{detail}</div>
    </div>
  );
}

// ---------- Main Board ----------

function exportClientsCsv(leads: CrmLead[]) {
  const headers = [
    "Business Name", "City", "Niche", "Stage", "Engagement", "Project Value",
    "Monthly Value", "Proposal Status", "Package", "Priority", "Contact", "Email",
    "Phone", "Website", "Next Action", "Due Date", "Health", "Proposal Sent",
    "Signed", "Project Start", "Launch Target", "Project Owner", "Renewal", "Notes",
  ];
  const escCsv = (v: string | null | undefined) => {
    if (!v) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = leads.map((l) => [
    l.businessName, l.city, l.niche, l.dealStage ?? "", l.engagementType ?? "",
    l.proposalValue ?? "", l.monthlyValue ?? "", l.proposalStatus ?? "",
    l.packageRecommendation ?? "", l.clientPriority ?? "", l.contactName ?? "",
    l.email ?? "", l.phone ?? "", l.websiteUrl ?? "", l.nextAction ?? "",
    toInputDate(l.nextActionDueAt),
    l.dealStage ? computeDealHealth(l) : "",
    toInputDate(l.proposalSentAt),
    toInputDate(l.signedAt),
    toInputDate(l.projectStartDate),
    toInputDate(l.launchTargetDate),
    l.projectOwner ?? "",
    toInputDate(l.renewalDate),
    l.projectNotes ?? "",
  ].map((v) => escCsv(String(v ?? ""))).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `axiom-clients-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ClientsBoard({ initialLeads }: { initialLeads: CrmLead[] }) {
  const { toast } = useToast();
  const [leads, setLeads] = useState<CrmLead[]>(initialLeads);
  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<CrmLead | null>(null);
  const [deleting, setDeleting] = useState(false);

  const inboxLeads = useMemo(
    () => leads.filter((l) => !l.dealStage && (l.outreachStatus === "REPLIED" || l.outreachStatus === "INTERESTED")),
    [leads],
  );

  const leadsByStage = useMemo(() => {
    const map = new Map<string, CrmLead[]>();
    for (const col of DEAL_KANBAN_COLUMNS) {
      map.set(col.stage, []);
    }
    for (const lead of leads) {
      if (lead.dealStage && map.has(lead.dealStage)) {
        map.get(lead.dealStage)!.push(lead);
      }
    }
    return map;
  }, [leads]);

  const handleResetInbox = useCallback(async () => {
    const res = await fetch("/api/leads/inbox/reset", { method: "POST" });
    if (!res.ok) return;
    setLeads((prev) =>
      prev.filter((l) => l.dealStage !== null || (l.outreachStatus !== "REPLIED" && l.outreachStatus !== "INTERESTED")),
    );
  }, []);

  const handleDismissInbox = useCallback(async (leadId: number) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/deal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outreachStatus: null }),
      });
      if (res.ok) {
        setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, outreachStatus: null } : l));
        toast("Dismissed from inbox", { type: "success" });
      }
    } finally {
      setSaving(false);
    }
  }, [toast]);

  const handleSave = useCallback(async (leadId: number, update: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/deal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save");
      }
      const updated = await res.json() as CrmLead;
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
      setEditing(null);
      toast("Deal updated", { type: "success" });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
      toast(msg, { type: "error" });
      return false;
    } finally {
      setSaving(false);
    }
  }, [toast]);

  const handleDragStart = useCallback((e: React.DragEvent, leadId: number) => {
    setDraggedLeadId(leadId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(leadId));
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedLeadId(null);
    setDragOverStage(null);
  }, []);

  const handleColumnDrop = useCallback(async (_e: React.DragEvent, stage: DealStage) => {
    if (!draggedLeadId) return;
    const lead = leads.find((l) => l.id === draggedLeadId);
    if (!lead || lead.dealStage === stage) {
      setDraggedLeadId(null);
      setDragOverStage(null);
      return;
    }
    setDragOverStage(null);
    setDraggedLeadId(null);
    await handleSave(lead.id, { dealStage: stage });
  }, [draggedLeadId, leads, handleSave]);

  const activeMrr = useMemo(
    () => leads
      .filter((l) => l.dealStage === "ACTIVE" || l.dealStage === "RETAINED")
      .reduce((s, l) => s + (l.monthlyValue ?? 0), 0),
    [leads],
  );

  const openPipelineValue = useMemo(
    () => leads
      .filter((l) => l.dealStage === "PROPOSAL_SENT" || l.dealStage === "NEGOTIATING" || l.dealStage === "SIGNED")
      .reduce((s, l) => s + (l.monthlyValue ?? 0), 0),
    [leads],
  );

  const proposalCount = useMemo(
    () => leads.filter((l) => l.dealStage === "PROPOSAL_SENT").length,
    [leads],
  );

  const actionDueCount = useMemo(
    () => leads.filter((l) => l.dealStage && l.dealStage !== "LOST" && isActionOverdue(l.nextActionDueAt)).length,
    [leads],
  );

  const renewalsSoon = useMemo(
    () => leads.filter((l) => {
      const d = getDaysUntilRenewal(l.renewalDate);
      return d !== null && d <= 30 && d >= 0;
    }),
    [leads],
  );

  const upcomingRenewals = useMemo(
    () => leads
      .filter((l) => {
        const d = getDaysUntilRenewal(l.renewalDate);
        return d !== null && d >= -7 && d <= 90;
      })
      .sort((a, b) => {
        const da = toTime(a.renewalDate);
        const db = toTime(b.renewalDate);
        return da - db;
      }),
    [leads],
  );

  const clientLeads = useMemo(
    () => leads.filter((l) => l.dealStage || l.outreachStatus === "REPLIED" || l.outreachStatus === "INTERESTED"),
    [leads],
  );

  const filteredLeadsByStage = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return leadsByStage;
    const map = new Map<string, CrmLead[]>();
    for (const [stage, stageLeads] of leadsByStage) {
      map.set(
        stage,
        stageLeads.filter(
          (l) =>
            l.businessName.toLowerCase().includes(q) ||
            l.city?.toLowerCase().includes(q) ||
            l.niche?.toLowerCase().includes(q) ||
            l.email?.toLowerCase().includes(q) ||
            l.contactName?.toLowerCase().includes(q),
        ),
      );
    }
    return map;
  }, [leadsByStage, searchQuery]);

  const filteredInbox = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inboxLeads;
    return inboxLeads.filter(
      (l) =>
        l.businessName.toLowerCase().includes(q) ||
        l.city?.toLowerCase().includes(q) ||
        l.niche?.toLowerCase().includes(q),
    );
  }, [inboxLeads, searchQuery]);

  const visibleMobileStages = DEAL_KANBAN_COLUMNS.filter((column) =>
    (filteredLeadsByStage.get(column.stage)?.length ?? 0) > 0,
  );
  const hasStagedDeals = leads.some((lead) => Boolean(lead.dealStage));

  const handleRemoveFromBoard = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const removed = await handleSave(deleteConfirm.id, { dealStage: null, dealLostReason: null });
      if (!removed) return;
      setLeads((prev) => prev.filter((l) => l.id !== deleteConfirm.id));
      toast(`${deleteConfirm.businessName} removed from board`, { type: "info" });
    } catch {
      // error already handled by handleSave
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, handleSave, toast]);

  const handleClientAdded = useCallback((lead: Record<string, unknown>) => {
    setLeads((prev) => {
      const exists = prev.some((l) => l.id === (lead as CrmLead).id);
      if (exists) return prev.map((l) => (l.id === (lead as CrmLead).id ? (lead as CrmLead) : l));
      return [lead as CrmLead, ...prev];
    });
  }, []);

  return (
    <div className="flex min-w-0 w-full flex-col gap-5 rounded-2xl border border-[#e1e5dc] bg-white p-4 shadow-sm sm:p-6">
      <AddClientDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdded={handleClientAdded}
      />
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => { if (!v) setDeleteConfirm(null); }}
        title="Remove from Board"
        description={`Remove "${deleteConfirm?.businessName}" from the CRM pipeline? The lead will remain in the Vault.`}
        confirmLabel="Remove"
        variant="destructive"
        loading={deleting}
        onConfirm={handleRemoveFromBoard}
      />

      {/* Find or create a record. */}
      <div className="flex flex-col gap-3 border-b border-[#e8ebe3] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#64766a]" aria-hidden="true" />
          <input
            type="text"
            aria-label="Search clients and opportunities"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clients or opportunities"
            className="min-h-11 w-full rounded-lg border border-[#d8e2d5] bg-white py-2 pl-10 pr-3 text-sm text-[#263a2f] placeholder:text-[#5b6d5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAddDialog(true)}
          data-hotkey="add"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#145943] bg-[#145943] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0e4935] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] cursor-pointer"
        >
          <Plus className="size-3.5" />
          Add client
        </button>
      </div>

      {/* Put owner actions first; financial estimates remain available below. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-3">
          <StatTile
            icon={<MessageSquare className="size-3.5" />}
            label="Replies to review"
            value={inboxLeads.length}
            detail="replied or interested"
            tone={inboxLeads.length > 0 ? "cyan" : "zinc"}
          />
          <StatTile
            icon={<Clock className="size-3.5" />}
            label="Overdue actions"
            value={actionDueCount}
            detail="follow-ups past due"
            tone={actionDueCount > 0 ? "red" : "zinc"}
          />
          <StatTile
            icon={<RefreshCw className="size-3.5" />}
            label="Renewals due soon"
            value={renewalsSoon.length}
            detail="within 30 days"
            tone={renewalsSoon.length > 0 ? "amber" : "zinc"}
          />
        </div>
        {clientLeads.length > 0 && (
          <button
            type="button"
            onClick={() => exportClientsCsv(clientLeads)}
            className="mt-1 flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-[#dfe7dd] bg-[#f0f4ee] px-3 py-2 text-xs font-medium text-[#526457] transition hover:border-[#c2d2c1] hover:bg-[#edf3eb] hover:text-[#263a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] lg:w-auto cursor-pointer"
          >
            <Download className="size-3.5" />
            Export CSV
          </button>
        )}
      </div>

      <details className="group rounded-xl border border-[#e1e5dc] bg-[#fafbf8]">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 text-sm font-semibold text-[#3b5947] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">View recorded value estimates</summary>
        <div className="grid gap-2 border-t border-[#e1e5dc] p-3 sm:grid-cols-2">
          <StatTile icon={<DollarSign className="size-3.5" />} label="Pipeline monthly estimate" value={`~${formatCompactMoney(openPipelineValue)}`} detail={`${proposalCount} proposal${proposalCount === 1 ? "" : "s"} pending · estimate only`} tone={openPipelineValue > 0 ? "amber" : "zinc"} />
          <StatTile icon={<DollarSign className="size-3.5" />} label="Recorded recurring estimate" value={`~${formatCompactMoney(activeMrr)}/mo`} detail="Entered in client records · not invoices or cash received" tone={activeMrr > 0 ? "emerald" : "zinc"} />
        </div>
      </details>

      {error && (
        <div role="alert" className="rounded-xl border border-[#e5c4bf] bg-[#fff4f2] px-4 py-3 text-sm text-[#8d2929] flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <InboxSection leads={filteredInbox} onEdit={setEditing} onQuickUpdate={handleSave} onReset={handleResetInbox} onDismiss={handleDismissInbox} saving={saving} />

      {visibleMobileStages.length > 0 ? <div className="flex flex-col gap-3 md:hidden" aria-label="Deal stages with clients">
        {visibleMobileStages.map((col) => (
          <MobileStageSection
            key={col.stage}
            label={col.label}
            description={col.description}
            leads={filteredLeadsByStage.get(col.stage) ?? []}
            onEdit={setEditing}
            onDelete={setDeleteConfirm}
          />
        ))}
      </div> : hasStagedDeals && searchQuery.trim() ? (
        <p className="rounded-xl border border-[#dfe7dd] bg-white px-4 py-5 text-sm text-[#566a5d] md:hidden">No deals match this search.</p>
      ) : null}

      {/* Kanban board with drag-and-drop */}
      {leads.length > 0 ? <div role="region" aria-label="Deal stages. Scroll horizontally to view every stage." tabIndex={0} className="hidden min-w-0 max-w-full gap-4 overflow-x-auto overscroll-x-contain rounded-2xl border border-[#e0e8dc] bg-white/70 p-4 pb-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] md:flex">
        {DEAL_KANBAN_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.stage}
            stage={col.stage}
            label={col.label}
            description={col.description}
            leads={filteredLeadsByStage.get(col.stage) ?? []}
            onEdit={setEditing}
            onDelete={setDeleteConfirm}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDrop={handleColumnDrop}
            isDragOver={dragOverStage === col.stage}
            onDragOver={(_e, stage) => setDragOverStage(stage)}
            onDragLeave={() => setDragOverStage(null)}
          />
        ))}
      </div> : null}

      {/* Renewal Calendar */}
      {upcomingRenewals.length > 0 && (
        <section className="rounded-2xl border border-[#e0e8dc] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="size-4 text-[#755312]" />
            <span className="text-sm font-semibold text-[#263a2f]">Renewal Calendar</span>
            <span className="font-mono text-[10px] text-[#64766a] border border-[#dfe7dd] bg-[#f4f7f1] rounded px-1 py-0.5">
              {upcomingRenewals.length}
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {upcomingRenewals.map((lead) => {
              const days = getDaysUntilRenewal(lead.renewalDate)!;
              const isOverdue = days < 0;
              const isUrgent = days >= 0 && days <= 7;
              const isSoon = days > 7 && days <= 30;
              return (
                <Link
                  key={lead.id}
                  href={`/clients/${lead.id}` as Route}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors hover:bg-[#f1f5ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]",
                    isOverdue ? "border-[#e5c4bf] bg-[#fff4f2]" :
                    isUrgent ? "border-[#e9dab6] bg-amber-500/5" :
                    isSoon ? "border-amber-500/10 bg-amber-500/[0.02]" :
                    "border-[#e3e9e0]"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#263a2f] truncate">{lead.businessName}</div>
                    <div className="text-[10.5px] text-[#64766a] mt-0.5">
                      {lead.monthlyValue ? `~${formatCompactMoney(lead.monthlyValue)}/mo estimate` : lead.niche}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn(
                      "text-xs font-semibold",
                      isOverdue ? "text-[#9b2f2f]" : isUrgent ? "text-[#755312]" : isSoon ? "text-[#755312]" : "text-[#526457]"
                    )}>
                      {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}
                    </div>
                    <div className="text-[11px] text-[#5b6d5f] mt-1">
                      {formatDate(lead.renewalDate)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {leads.length === 0 && inboxLeads.length === 0 && (
        <div className="flex items-start gap-4 rounded-xl border border-dashed border-[#cfd9cd] bg-[#fafbf8] px-5 py-7">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#eaf1e9]"><Building2 className="size-5 text-[#42624d]" /></span>
          <div>
            <div className="text-sm font-semibold text-[#263a2f]">No client records to review</div>
            <p className="mt-1 max-w-md text-sm leading-6 text-[#5b6d5f]">Replies and owner-created client records will appear here. Add a record when there is a real relationship to track.</p>
          </div>
        </div>
      )}

      {editing && (
        <DealDrawer
          lead={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onRemove={(lead) => setDeleteConfirm(lead)}
          saving={saving}
        />
      )}
    </div>
  );
}
