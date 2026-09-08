const stateLabels = {
  planning: "Planning",
  coding: "Coding",
  testing: "Testing",
  fixing: "Fixing",
  verification: "Verification",
  committed: "Committed",
  blocked: "Blocked",
  inactive: "Inactive",
};

const stageLabels = {
  complete: "Complete",
  in_progress: "In progress",
  blocked: "Blocked",
  not_started: "Not started",
  locked: "Locked",
};

const byId = (id) => document.getElementById(id);

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function renderList(id, items) {
  const list = byId(id);
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    row.textContent = item;
    list.append(row);
  }
}

function renderStages(stages) {
  const list = byId("stage-list");
  list.replaceChildren();
  for (const stage of stages) {
    const item = document.createElement("li");
    item.className = `stage-item stage-${stage.state}`;
    const rail = document.createElement("span");
    rail.className = "stage-rail";
    rail.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    body.className = "stage-body";
    const heading = document.createElement("div");
    heading.className = "stage-heading";
    const label = document.createElement("strong");
    label.textContent = stage.label;
    const state = document.createElement("span");
    state.className = "stage-state";
    state.textContent = stageLabels[stage.state] ?? stage.state;
    const summary = document.createElement("p");
    summary.textContent = stage.summary;
    heading.append(label, state);
    body.append(heading, summary);
    item.append(rail, body);
    list.append(item);
  }
}

function renderTimeline(timeline) {
  const list = byId("timeline-list");
  list.replaceChildren();
  for (const entry of timeline) {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    marker.className = `timeline-marker state-${entry.state}`;
    marker.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "timeline-meta";
    const state = document.createElement("strong");
    state.textContent = stateLabels[entry.state] ?? entry.state;
    const time = document.createElement("time");
    time.dateTime = entry.at;
    time.textContent = formatTime(entry.at);
    const message = document.createElement("p");
    message.textContent = entry.message;
    meta.append(state, time);
    body.append(meta, message);
    item.append(marker, body);
    list.append(item);
  }
}

function render(payload) {
  const { monitor, workingCopy, servedAt } = payload;
  setText("milestone-heading", monitor.milestone);
  setText("last-update", monitor.lastMeaningfulUpdate);
  setText("updated-at", formatTime(monitor.updatedAt));
  const badge = byId("state-badge");
  badge.textContent = stateLabels[monitor.state] ?? monitor.state;
  badge.className = `state-badge state-${monitor.state}`;

  setText("safety-sends", monitor.safety.outboundSending);
  setText("safety-production", monitor.safety.productionChanges);
  setText("safety-contact", monitor.safety.externalProspectContact);
  setText("safety-providers", monitor.safety.paidProviderOperations);
  setText(
    "safety-storage",
    monitor.safety.storageBoundary === "LOCAL_CANONICAL_CHECKOUT_ONLY"
      ? "LOCAL ONLY"
      : "UNAVAILABLE",
  );
  setText("safety-spend", `C$${monitor.safety.spendImpactCad.toFixed(2)}`);

  setText("verified-sha", monitor.lastVerifiedCheckpoint.shortSha);
  setText("verified-title", monitor.lastVerifiedCheckpoint.title);
  setText("verified-time", `Verified ${formatTime(monitor.lastVerifiedCheckpoint.verifiedAt)}`);

  const clean = workingCopy.status === "CLEAN";
  const verifiedHead = clean && workingCopy.matchesLastVerifiedCheckpoint;
  setText(
    "working-status",
    verifiedHead ? "Clean + verified" : clean ? "Clean, not verified" : "Uncommitted",
  );
  setText("working-title", `${workingCopy.shortHeadSha} · ${workingCopy.headTitle}`);
  setText(
    "working-detail",
    verifiedHead
      ? "No uncommitted files; this is the verified checkpoint."
      : clean
        ? "No uncommitted files, but this commit has not passed the recorded release gate."
        : `${workingCopy.changedCount} changed file${workingCopy.changedCount === 1 ? "" : "s"}; not part of the verified checkpoint yet.`,
  );
  const indicator = byId("working-indicator");
  indicator.className = `working-indicator ${verifiedHead ? "is-clean" : "is-dirty"}`;

  renderStages(monitor.stages);
  renderList("completed-list", monitor.completedWork);
  renderList("current-list", monitor.currentWork);
  renderList("next-list", monitor.nextWork);
  renderTimeline(monitor.timeline);

  if (monitor.blocker) {
    byId("blocker-panel").classList.add("has-blocker");
    setText("blocker-heading", monitor.blocker.summary);
    setText("owner-action", monitor.blocker.ownerAction);
  } else {
    byId("blocker-panel").classList.remove("has-blocker");
    setText("blocker-heading", "No owner action needed right now");
    setText("owner-action", "The current milestone can continue safely without you.");
  }
  byId("error-banner").hidden = true;
  setText("refreshed-at", `Refreshed ${formatTime(servedAt)}`);
  setText("monitor-status", `Rebuild monitor updated. Current state: ${stateLabels[monitor.state]}.`);
}

async function refresh() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Monitor state request failed.");
    render(await response.json());
    document.body.classList.remove("monitor-error");
  } catch {
    renderFailure();
  }
}

function renderFailure() {
  document.body.classList.add("monitor-error");
  byId("error-banner").hidden = false;
  setText("state-badge", "Read failed");
  setText("milestone-heading", "Live rebuild state unavailable");
  setText("last-update", "The local monitor could not validate its persisted state. Keep the monitor terminal open or use the documented recovery step.");
  setText("updated-at", "Unavailable");
  for (const id of [
    "safety-sends",
    "safety-production",
    "safety-contact",
    "safety-providers",
    "safety-storage",
    "safety-spend",
    "verified-sha",
    "verified-title",
    "verified-time",
    "working-status",
    "working-title",
    "working-detail",
    "refreshed-at",
  ]) setText(id, "UNAVAILABLE");
  renderStages([]);
  renderList("completed-list", ["Unavailable until local state validates again."]);
  renderList("current-list", ["Restore the local monitor before relying on status."]);
  renderList("next-list", ["Follow the recovery step in the owner guide."]);
  renderTimeline([]);
  byId("blocker-panel").classList.add("has-blocker");
  setText("blocker-heading", "Local monitor state could not be validated");
  setText("owner-action", "Keep the monitor terminal open. If the error remains, ask Codex to recover the rebuild monitor from Git and docs/STATUS.md.");
  setText("monitor-status", "The local rebuild monitor could not refresh.");
}

refresh();
window.setInterval(refresh, 5_000);
