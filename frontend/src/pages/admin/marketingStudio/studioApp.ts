// @ts-nocheck -- ported from the reference Marketing Studio (published version 5, app.js).
/**
 * The Marketing Studio screen logic, kept as close to the reference app as
 * possible so it behaves the way Yvette already knows. What changed:
 *  - everything runs inside mountStudio(root) and only touches elements under
 *    `root` (ids are prefixed "ms-"), so it can sit inside the admin console;
 *  - saves go to her account (PUT /api/admin/marketing-studio) instead of
 *    browser storage, so phone and computer see the same drafts. A browser
 *    copy is still written as a safety net;
 *  - the pre-replacement recovery snapshot is kept with the account;
 *  - hook templates can be added, edited and archived (brief §5);
 *  - messaging-first workflow (addenda of 20/21 Nov 2026, see messaging.ts):
 *    buyer profiles, content angles, FlourisHealer Retreats, NICHE/RETREAT
 *    routes, Comment/DM invitations, a Message Quality Review, and the old
 *    five-pillar series kept as an opt-in "Legacy rotation".
 *
 * Nothing on mount writes to the account: new keys (`profiles`, `retreats`,
 * `retreatMessaging`, `routeEdits`) are only created when she saves one, and
 * missing settings fall back to defaults on read.
 */
import { COACHING_INSIGHTS, addCoachingInsights } from "./coachingInsights";
import { HOOKS } from "./hooks";
import {
  newId,
  PILLARS,
  FORMATS,
  ENDINGS,
  DEFINITIONS,
  ROUTES,
  topicList,
  checkFit,
  recommendedRoute,
  resourceFor,
  createPost,
  toCSV,
  completePost,
  series,
  validateBackup,
  mergeBackup,
  EXPORT_FIELDS,
} from "./engine";
import { STUDIO_TEMPLATE } from "./studioTemplate";
import {
  RETREAT_AUDIENCE,
  RETREAT_TYPES,
  RETREAT_DEFINITION,
  AUDIENCES,
  MESSAGE_FORMATS,
  AUDIENCE_ROUTES,
  routeTable,
  anglesFor,
  retreatMessaging,
  RETREAT_MESSAGING,
  PROFILE_FIELDS,
  allProfiles,
  profilesFor,
  upsertById,
  duplicateProfile,
  RETREAT_FACT_FIELDS,
  allRetreats,
  retreatsFor,
  missingRetreatFacts,
  checkMessage,
  messageResource,
  createMessagePost,
  reviewPost,
  splitPost,
  NEEDS_MARKER,
} from "./messaging";

export interface StudioSaveBody {
  state: unknown;
  version: number;
  recovery?: unknown;
}

export function mountStudio(
  root,
  opts,
) {
root.innerHTML = STUDIO_TEMPLATE;


const $ = (id) => root.querySelector("#ms-" + id),
  esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KEY = "bc-marketing-v3";
let state = opts.initial ? structuredClone(opts.initial) : null;
let version = opts.version || 0;
let recovery = opts.recovery || null;
if (!state) {
  state = {
    settings: {
      audience: "",
      audienceStage: "",
      topicId: "",
      pillar: PILLARS[0],
      format: "Spoken",
      ctaType: ENDINGS[0],
      hashtags: "#BossClinician #PrivatePractice #PracticeOwnership",
    },
    posts: [],
    savedIdeas: [],
    legacy: {},
    hookEdits: {},
    customHooks: [],
  };
}
state.hookEdits ||= {};
state.customHooks ||= [];
let showArchived = false;
let currentView = "studio",
  libraryPillar = "All",
  libraryPage = 1,
  editing = null,
  pendingImport = null,
  toastTimer;
let saveTimer = null,
  saving = false,
  dirty = false,
  sendRecovery = false,
  stopped = false;
function saveStatus(text, bad = false) {
  const el = $("save-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("bad", bad);
}
function persist() {
  dirty = true;
  // A same-browser copy, so a dropped connection never loses an edit.
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, version }));
  } catch {
    /* storage full or blocked: the account copy is the real one */
  }
  if (stopped) return;
  saveStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}
async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (saving || !dirty || stopped) return;
  saving = true;
  dirty = false;
  const body = { state: structuredClone(state), version };
  if (sendRecovery) body.recovery = recovery;
  try {
    const res = await opts.save(body);
    version = res.version;
    sendRecovery = false;
    saveStatus(dirty ? "Saving…" : "All changes saved");
  } catch (e) {
    dirty = true;
    if (e && e.status === 409) {
      stopped = true;
      saveStatus("Changed on another device · not saved", true);
      notify("This studio was changed in another window or device. Download a JSON backup of this screen, then reload the page to see the latest copy.");
    } else {
      saveStatus("Not saved yet · retrying", true);
      saveTimer = setTimeout(flush, 5000);
    }
  } finally {
    saving = false;
    if (dirty && !stopped && !saveTimer) saveTimer = setTimeout(flush, 700);
  }
}
const onBeforeUnload = (e) => {
  if (dirty || saving) {
    e.preventDefault();
    e.returnValue = "";
  }
};
window.addEventListener("beforeunload", onBeforeUnload);
function notify(t) {
  $("toast").textContent = t;
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 4500);
}
function download(text, name, type) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const formIds = [
  "audience",
  "audienceStage",
  "topicId",
  "pillar",
  "format",
  "ctaType",
  "hook",
  "story",
  "lesson",
  "result",
  "contributors",
  "context",
  "hashtags",
  "postingDate",
  // messaging-first fields (absent from settings saved before 21 Nov: they read as blank)
  "mode",
  "profileId",
  "pointA",
  "symptom",
  "pointB",
  "beliefShift",
  "mechanism",
  "objection",
  "proof",
  "angle",
  "messageFormat",
  "ctaAction",
  "pillarTag",
  "retreatId",
  "hookTemplateId",
];
const checkIds = ["useCampaignLine", "useTagline", "proofPermission"];
const dynamicIds = new Set(["mode", "audience", "audienceStage", "topicId", "profileId", "angle", "retreatId", "ctaAction"]);
const buyerFields = ["pointA", "symptom", "pointB", "beliefShift", "mechanism", "objection", "proof"];
function settings() {
  const s = Object.fromEntries(formIds.map((k) => [k, $(k).value]));
  for (const k of checkIds) s[k] = $(k).checked;
  s.override = { word: $("override-word").value, resource: $("override-resource").value.trim(), url: $("override-url").value.trim() };
  return s;
}
function populate() {
  const s = state.settings || {};
  $("mode").value = s.mode === "legacy" ? "legacy" : "messaging";
  $("audience").value = AUDIENCES.includes(s.audience) ? s.audience : "";
  buildStages(s.audienceStage || "");
  for (const k of formIds) if ($(k) && !dynamicIds.has(k)) $(k).value = s[k] || "";
  if (!$("messageFormat").value) $("messageFormat").value = MESSAGE_FORMATS[0];
  $("ctaAction").value = s.ctaAction === "DM" ? "DM" : "Comment";
  for (const k of checkIds) $(k).checked = !!s[k];
  updateTopics(s.topicId);
  refreshMessaging({ profileId: s.profileId, angle: s.angle, retreatId: s.retreatId });
  $("override-word").value = s.override?.word || "";
  $("override-resource").value = s.override?.resource || "";
  $("override-url").value = s.override?.url || "";
  updateBuilder();
}
function buildStages(selected = "") {
  const a = $("audience").value;
  const opts =
    a === "Boardroom"
      ? [["first", "Preparing to hire my first clinician."], ["team", "Already leading a team."]]
      : a === RETREAT_AUDIENCE
        ? Object.entries(RETREAT_TYPES)
        : [];
  $("audienceStage").innerHTML =
    `<option value="">${a === RETREAT_AUDIENCE ? "Choose a retreat type…" : "Choose a stage…"}</option>` +
    opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  $("audienceStage").value = opts.some(([v]) => v === selected) ? selected : "";
  $("stage-label").textContent = a === RETREAT_AUDIENCE ? "Retreat type" : "Boardroom audience stage";
}
function buildOverrideWords() {
  const a = $("audience").value,
    current = $("override-word").value;
  const words = $("mode").value === "messaging" ? AUDIENCE_ROUTES[a] || [] : Object.keys(ROUTES).filter((w) => w !== "RETREAT");
  $("override-word").innerHTML = '<option value="">Use recommendation</option>' + words.map((x) => `<option>${x}</option>`).join("");
  $("override-word").value = words.includes(current) ? current : "";
}
function updateTopics(selected = "") {
  buildStages($("audienceStage").value);
  const s = settings();
  $("stage-wrap").classList.toggle("hidden", s.audience !== "Boardroom" && s.audience !== RETREAT_AUDIENCE);
  $("audienceStage").required = s.audience === "Boardroom" || s.audience === RETREAT_AUDIENCE;
  $("topic-wrap").classList.toggle("hidden", s.audience === RETREAT_AUDIENCE);
  buildOverrideWords();
  $("topicId").innerHTML =
    '<option value="">Choose a topic…</option>' +
    topicList({ ...s, audienceStage: $("audienceStage").value })
      .map((t) => `<option value="${t.id}">${esc(t.label)}</option>`)
      .join("");
  $("topicId").value = selected;
}
function updateBuilder() {
  const s = settings(),
    isMsg = s.mode !== "legacy",
    retreat = s.audience === RETREAT_AUDIENCE,
    c = ctx(s),
    errs = isMsg ? checkMessage(s, c) : checkFit(s);
  root.querySelectorAll("#ms-builder .msg-only").forEach((el) => el.classList.toggle("hidden", !isMsg));
  root.querySelectorAll("#ms-builder .legacy-only").forEach((el) => el.classList.toggle("hidden", isMsg));
  root.querySelectorAll("#ms-builder .retreat-only").forEach((el) => el.classList.toggle("hidden", !(isMsg && retreat)));
  $("objection-wrap").classList.toggle("hidden", !isMsg || s.angle !== "objection" || retreat);
  $("proof-wrap").classList.toggle("hidden", !isMsg || !["founder", "member"].includes(s.angle));
  $("proofPermission-wrap").classList.toggle("hidden", !isMsg || s.angle !== "member");
  $("pillarTag").closest("label").classList.toggle("hidden", !isMsg || retreat);
  $("useTagline-wrap").classList.toggle("hidden", !(isMsg && retreat && s.audienceStage === "international"));
  $("mode-hint").textContent = isMsg
    ? "Start from the buyer: profile, the problem they recognise, one symptom, the result they want, one point, then the offer."
    : "The original pillar-based post. Hooks and the five-pillar rotation work as before. Not used for FlourisHealer Retreats.";
  $("definition").textContent = retreat ? RETREAT_DEFINITION : DEFINITIONS[s.audience] || "Choose an audience before creating content.";
  for (const k of ["story", "lesson"]) $(k + "-wrap").classList.toggle("hidden", isMsg || s.pillar !== "Personal Story");
  for (const k of ["result", "contributors", "context"]) $(k + "-wrap").classList.toggle("hidden", isMsg || s.pillar !== "Success Story");
  renderBuyerPanels(s, c);
  $("ending-hint").textContent =
    s.ctaType === "Reflective ending"
      ? "Script ends with reflection. Full resource CTA starts the caption; a short CTA appears on the closing screen."
      : s.ctaType === "Engagement question"
        ? "Script and caption end with a question. No automatic keyword, resource invitation, or resource URL."
        : "Resource invitation ends both script and caption, with a matching closing screen.";
  $("override-details").classList.toggle("hidden", s.ctaType === "Engagement question");
  if (errs.length) {
    $("fit-summary").innerHTML = s.audience ? `<p class="hint">Before creating: ${esc(errs.join(" "))}</p>` : "";
    $("route-preview").innerHTML = "<p>Choose an audience, its stage when applicable, and a topic to see your recommended route.</p>";
    return;
  }
  if (isMsg) {
    const r = messageResource(s, c);
    $("fit-summary").innerHTML = `<div class="fit">Audience fit: ${esc(s.audience)}${s.audienceStage ? " · " + esc(retreat ? RETREAT_TYPES[s.audienceStage] : s.audienceStage === "first" ? "Preparing for a first hire" : "Already leading a team") : ""} · Profile: ${esc(c.profile.name)}. ${retreat ? "Travel experience, not treatment. Retreat facts come only from the retreat record." : s.audience === "Club" ? "No existing website, clients, caseload or team assumed." : s.audience === "Lounge" ? "Speaks to an established owner improving the current practice." : s.audienceStage === "first" ? "No existing team assumed." : "Hiring and leadership content stays under Boardroom."}</div>`;
    $("route-preview").innerHTML =
      s.ctaType === "Engagement question"
        ? "<strong>Engagement only</strong><p>One specific question. No keyword or resource invitation will be added.</p>"
        : `<strong>Recommended: ${esc(r.word)}${s.override.word || s.override.resource || s.override.url ? " · Override active" : ""}</strong><p>Keyword: <b>${esc(r.word)}</b> · ${esc(r.action)}<br>Resource: ${esc(r.resource)}<br>Destination: ${safeLink(r.url)}<br>Invitation: “${esc(r.line)}”</p><p class="hint">${r.action === "DM" ? "DM wording only. The studio does not know whether DM automation is set up; check before posting." : "One action per post. The studio does not send or automate replies."}</p>`;
    return;
  }
  const recommended = recommendedRoute(s),
    r = resourceFor(s);
  $("fit-summary").innerHTML =
    `<div class="fit">Audience fit: ${esc(s.audience)} · ${esc(s.audience === "Boardroom" ? (s.audienceStage === "first" ? "Preparing for a first hire" : "Already leading a team") : "stage-appropriate topic selected")}. ${s.audience === "Club" ? "No existing website, clients, or team assumed." : s.audience === "Lounge" ? "Focus stays on improving the current practice." : "Hiring and leadership content stays under Boardroom."}</div>`;
  $("route-preview").innerHTML =
    s.ctaType === "Engagement question"
      ? "<strong>Engagement only</strong><p>No keyword or resource invitation will be added.</p>"
      : `<strong>Recommended: ${recommended}${s.override.word || s.override.resource || s.override.url ? " · Override active" : ""}</strong><p>Selected keyword: <b>${esc(r.word)}</b> (${s.ctaAction === "DM" ? "DM" : "Comment"})<br>Resource: ${esc(r.resource)}<br>Destination: ${safeLink(r.url)}</p><p class="hint">The invitation connects to the chosen topic. A quiz or assessment is a reflection tool, not proof of enrollment readiness.</p>`;
}
function safeLink(url) {
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol)) return esc(url);
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
  } catch {
    return esc(url);
  }
}
function validate(s, legacy = s.mode === "legacy") {
  const errors = legacy ? checkFit(s) : checkMessage(s, ctx(s));
  if (s.ctaType !== "Engagement question" && s.override?.url) {
    try {
      if (new URL(s.override.url).protocol !== "https:") errors.push("Use an HTTPS resource URL.");
    } catch {
      errors.push("Use a valid resource URL.");
    }
  }
  if (errors.length) {
    notify(errors.join(" "));
    return false;
  }
  return true;
}
function persistSettings() {
  state.settings = settings();
  persist();
}
function view(v) {
  currentView = v;
  root.querySelectorAll(".tabview").forEach((el) => el.classList.toggle("active", el.id === "ms-" + v));
  root.querySelectorAll(".ms-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("page-title").textContent = {
    studio: "Make your message meet them where they are.",
    library: "An evergreen library. A fresh message.",
    saved: "Keep the ideas you’ll come back to.",
    planner: "Your content, with a clear next step.",
    backup: "Your work. A copy you control.",
    insights: "Real conversations. Useful content.",
  }[v];
  if (v === "insights") renderInsights();
  if (v === "library") renderLibrary();
  if (v === "saved") renderSaved();
  if (v === "planner") renderPlanner();
  root.scrollIntoView({ block: "start", behavior: "smooth" });
}
function card(h) {
  return `<article class="card${h.archived ? " archived" : ""}"><div class="thumb">${esc(h.pillar)}${h.archived ? " · Archived" : ""} <button class="save" style="position:static;float:right" aria-label="${state.savedIdeas.includes(h.id) ? "Unsave" : "Save"} hook ${h.id}" data-save="${h.id}">${state.savedIdeas.includes(h.id) ? "♥" : "♡"}</button></div><div class="cardbody"><div class="meta">Hook ${h.day} · ${h.custom ? "Your template" : h.edited ? "Evergreen · edited" : "Evergreen"}<button class="hookedit" data-edit-hook="${h.id}" aria-label="Edit hook template ${h.id}">Edit</button></div><h3>${esc(h.hook)}</h3><p class="hint">Choose your audience and topic to personalize this formula.</p><button class="textbtn" data-use="${h.id}">Use this hook →</button></div></article>`;
}
function bindCards(el) {
  el.querySelectorAll("[data-save]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = Number(b.dataset.save);
        state.savedIdeas = state.savedIdeas.includes(id) ? state.savedIdeas.filter((x) => x !== id) : [...state.savedIdeas, id];
        persist();
        renderLibrary();
        renderSaved();
      }),
  );
  el.querySelectorAll("[data-edit-hook]").forEach((b) => (b.onclick = () => openHookEditor(Number(b.dataset.editHook))));
  el.querySelectorAll("[data-use]").forEach(
    (b) =>
      (b.onclick = () => {
        const h = allHooks().find((h) => h.id === Number(b.dataset.use));
        $("pillar").value = h.pillar;
        if ($("audience").value !== RETREAT_AUDIENCE) $("pillarTag").value = h.pillar;
        $("hook").value = h.hook;
        $("hookTemplateId").value = String(h.id);
        $("hook-note").textContent = "Library hook loaded. Review the opening for your selected audience.";
        updateBuilder();
        persistSettings();
        view("studio");
      }),
  );
}
function renderLibrary() {
  const q = $("search").value.toLowerCase(),
    fmt = $("format-filter").value;
  let list = allHooks().filter((h) => (showArchived || !h.archived) && (libraryPillar === "All" || h.pillar === libraryPillar) && h.hook.toLowerCase().includes(q));
  $("hook-count").textContent = String(allHooks().filter((h) => !h.archived).length);
  if (fmt !== "All formats")
    list = list.filter((h) =>
      (h.pillar === "How-To Guide"
        ? ["Spoken", "Carousel"]
        : h.pillar === "Success Story"
          ? ["Spoken", "Carousel", "B-roll"]
          : FORMATS
      ).includes(fmt),
    );
  $("pillar-filters").innerHTML = ["All", ...PILLARS]
    .map(
      (p) => `<button class="chip ${p === libraryPillar ? "selected" : ""}" data-pillar="${p}">${p === "All" ? "All pillars" : p}</button>`,
    )
    .join("");
  $("pillar-filters")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          libraryPillar = b.dataset.pillar;
          libraryPage = 1;
          renderLibrary();
        }),
    );
  const pages = Math.max(1, Math.ceil(list.length / 18));
  libraryPage = Math.min(libraryPage, pages);
  $("hook-grid").innerHTML =
    list
      .slice((libraryPage - 1) * 18, libraryPage * 18)
      .map(card)
      .join("") || '<div class="empty">No hooks match these filters.</div>';
  $("hook-pages").innerHTML =
    `<button class="outline" id="ms-prev-page" ${libraryPage === 1 ? "disabled" : ""}>← Previous</button><span>${list.length} hooks · Page ${libraryPage} of ${pages}</span><button class="outline" id="ms-next-page" ${libraryPage === pages ? "disabled" : ""}>Next →</button>`;
  $("prev-page").onclick = () => {
    libraryPage--;
    renderLibrary();
  };
  $("next-page").onclick = () => {
    libraryPage++;
    renderLibrary();
  };
  bindCards($("hook-grid"));
}
function renderSaved() {
  const list = allHooks().filter((h) => state.savedIdeas.includes(h.id));
  $("saved-grid").innerHTML = list.map(card).join("") || '<div class="empty">Tap a heart in the hook library to save an idea.</div>';
  bindCards($("saved-grid"));
}
function sortedPosts() {
  return [...state.posts].sort(
    (a, b) =>
      (a.postingDate || "9999").localeCompare(b.postingDate || "9999") ||
      (a.seriesPosition || 0) - (b.seriesPosition || 0) ||
      (a.createdAt || "").localeCompare(b.createdAt || ""),
  );
}
function renderPlanner() {
  const q = $("post-search").value.toLowerCase();
  $("planner-summary").innerHTML = [
    ["Saved posts", state.posts.length],
    ["Scheduled", state.posts.filter((p) => p.postingDate).length],
    ["Needs details", state.posts.filter((p) => p.needsDetails).length],
  ]
    .map(([l, n]) => `<div class="statbox"><b>${n}</b>${l}</div>`)
    .join("");
  $("planner-rows").innerHTML =
    sortedPosts()
      .filter((p) => [p.hook, p.audience, p.pillar, p.topic, p.profileName, p.angleLabel, p.retreatName].join(" ").toLowerCase().includes(q))
      .map(
        (p) =>
          `<tr><td>${esc(p.postingDate || "Not scheduled")}<br><span class="status">${esc(p.status)}</span></td><td>${esc(p.audience || "Legacy · review needed")}<br><span class="hint">${esc(p.audienceStage)}</span></td><td>${esc(p.pillar || "No pillar")}<br>${esc(p.format)}</td><td>${esc(p.hook)}${p.angleLabel ? `<br><span class="hint">${esc(p.angleLabel)}${p.profileName ? " · " + esc(p.profileName) : ""}</span>` : ""}${p.importLabel ? '<p class="warning">Imported conflicting copy</p>' : ""}</td><td>${esc(p.dmWord || (p.resourceName ? "Resource invitation" : "No resource CTA"))}<br>${esc(p.resourceName)}</td><td><button class="outline" data-edit="${esc(p.id)}">Open draft</button></td></tr>`,
      )
      .join("") || '<tr><td colspan="6">No posts yet. Create a post or a series in the Studio.</td></tr>';
  $("planner-rows")
    .querySelectorAll("[data-edit]")
    .forEach((b) => (b.onclick = () => openEditor(state.posts.find((p) => p.id === b.dataset.edit))));
  const keys = Object.keys(state.legacy || {});
  $("legacy-box").classList.toggle("hidden", !keys.length);
  $("legacy-box").innerHTML =
    '<h3>Earlier saved work is preserved</h3><p class="hint">Earlier drafts were carried forward without rewriting them. Their audience and resource fields may need review. Original legacy settings are also included in JSON backups.</p>';
}
function routeFields(p) {
  return `<div class="routebox"><b>Selected resource beside this post</b><div class="formgrid" style="margin-top:12px"><label class="field">Keyword${p.ctaAction === "DM" ? " (DM)" : p.mode === "messaging" ? " (Comment)" : ""}<input id="ms-e-dmWord" value="${esc(p.dmWord)}"></label><label class="field">Resource name<input id="ms-e-resourceName" value="${esc(p.resourceName)}"></label><label class="field wide">Resource URL<input id="ms-e-resourceUrl" value="${esc(p.resourceUrl)}" type="url"></label></div><p class="hint">${esc(p.ctaType)}. ${p.collection ? "Your supplied invitation is preserved. Edit its wording directly in the script and caption. Add a booking URL when available." : "If you edit these fields, use “Apply resource fields to invitations” to update the draft’s invitation text."}</p><button class="outline" id="ms-apply-resource" ${p.collection ? "hidden" : ""}>Apply resource fields to invitations</button></div>`;
}
function openEditor(p) {
  editing = structuredClone(p);
  const stored = state.posts.some((x) => x.id === p.id);
  $("editor-content").innerHTML =
    `<span class="tag">${esc(p.audience || "Legacy draft")} · ${esc(p.audienceStage)}</span><h2 id="ms-editor-title">Your editable post</h2><p class="hint">${esc(p.topic || "Earlier saved content")} · ${esc(p.ctaType)}${p.contentLabel ? " · " + esc(p.contentLabel) : ""}</p>${p.needsDetails ? '<div class="warning">Complete the marked prompts before publishing. Personal and success stories must use your supplied details.</div>' : ""}<div class="formgrid" style="margin-top:18px"><label class="field">Assigned pillar<select id="ms-e-pillar"><option value="" ${!p.pillar ? "selected" : ""}>No pillar</option>${[...new Set([...PILLARS, p.pillar].filter(Boolean))].map((x) => `<option ${p.pillar === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label><label class="field">Format<select id="ms-e-format">${[...new Set([...FORMATS, ...MESSAGE_FORMATS, p.format].filter(Boolean))].map((x) => `<option ${p.format === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label><label class="field wide">Hook<input id="ms-e-hook" value="${esc(p.hook)}"></label><label class="field wide">Full spoken script<textarea class="output" id="ms-e-script">${esc(p.script)}</textarea><button class="textbtn" data-copy="script">Copy script</button></label><label class="field wide">Carousel text<textarea class="output" id="ms-e-carousel">${esc(p.carousel)}</textarea><button class="textbtn" data-copy="carousel">Copy carousel text</button></label><label class="field wide">Caption<textarea class="output" id="ms-e-caption">${esc(p.caption)}</textarea><button class="textbtn" data-copy="caption">Copy caption</button></label><label class="field wide">Closing-screen text<textarea class="output small" id="ms-e-closingScreen">${esc(p.closingScreen)}</textarea></label><label class="field wide">Hashtags<input id="ms-e-hashtags" value="${esc(p.hashtags)}"></label><label class="field">Posting date<input id="ms-e-postingDate" type="date" value="${esc(p.postingDate)}"></label><label class="field">Status<select id="ms-e-status">${["Idea", "Needs details", "Drafting", "Ready", "Published"].map((x) => `<option ${p.status === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>${p.mode === "messaging" ? `<label class="field wide">Filming / slide direction<textarea class="output small" id="ms-e-filming">${esc(p.filming)}</textarea></label><label class="field wide">Story follow-up<textarea class="output small" id="ms-e-storyFollowUp">${esc(p.storyFollowUp)}</textarea></label>` : ""}</div>${messageMeta(p)}${routeFields(p)}${qualityBlock(p)}<p class="hint">Manual pillar changes keep your edited text. To draft a new pillar-specific structure, create a new post from Studio. Dates and manual pillar changes may change the original series rotation.</p><div class="actions"><button class="primary" id="ms-save-post">${stored ? "Save changes" : "Save post to planner"}</button><button class="outline" id="ms-save-copy">Save as new copy</button><button class="outline" data-copy="complete">Copy complete post</button><button class="outline" id="ms-download-post">Download complete post</button>${numberedPoints(p) >= 3 ? '<button class="outline" id="ms-split-post">Split into separate posts</button>' : ""}</div>${p.history?.length ? `<p class="hint">${p.history.length} earlier saved version${p.history.length === 1 ? "" : "s"} kept with this draft (included in JSON backups).</p>` : ""}<p class="hint" id="ms-copy-result" role="status"></p>`;
  for (const b of $("editor-content").querySelectorAll("[data-copy]")) b.onclick = () => copyPart(b.dataset.copy);
  $("save-post").onclick = () => savePost(false);
  $("save-copy").onclick = () => savePost(true);
  $("download-post").onclick = () => {
    collectEditor();
    download(completePost(editing), "Boss_Clinician_Post.txt", "text/plain");
  };
  $("apply-resource").onclick = applyEditedResource;
  if ($("split-post"))
    $("split-post").onclick = () => {
      collectEditor();
      const parts = splitPost(editing);
      state.posts.push(...parts);
      persist();
      $("editor").close();
      renderPlanner();
      notify(parts.length + " separate drafts added to the planner. This draft is unchanged.");
    };
  if (!$("editor").open) $("editor").showModal();
}
const editFields = [
  "pillar",
  "format",
  "hook",
  "script",
  "carousel",
  "caption",
  "closingScreen",
  "hashtags",
  "postingDate",
  "status",
  "dmWord",
  "resourceName",
  "resourceUrl",
  "filming",
  "storyFollowUp",
];
function collectEditor() {
  // Only fields shown for this draft are read, so an older draft never gains blank new fields.
  for (const f of editFields) if ($("e-" + f)) editing[f] = $("e-" + f).value;
  const reviewed = $("e-qualityReviewed");
  if (reviewed && (reviewed.checked || editing.qualityReviewed !== undefined)) editing.qualityReviewed = reviewed.checked;
  editing.needsDetails = NEEDS_MARKER.test(editing.script + " " + editing.caption);
  if (editing.ctaType === "Engagement question") {
    editing.dmWord = "";
    editing.resourceName = "";
    editing.resourceUrl = "";
  }
  return editing;
}
function applyEditedResource() {
  const old = structuredClone(editing);
  collectEditor();
  if (editing.ctaType === "Engagement question") {
    notify("Engagement-only posts do not receive resource invitations.");
    openEditor(editing);
    return;
  }
  if (!editing.dmWord || !editing.resourceName || !/^https:\/\//.test(editing.resourceUrl)) {
    notify("Enter a DM word, resource name, and valid HTTPS URL.");
    return;
  }
  if (editing.mode === "messaging") {
    applyMessageResource(old);
    return;
  }
  if (!editing.settings) {
    notify("Legacy draft: edit the invitation in the text fields directly.");
    return;
  }
  const s = structuredClone(editing.settings);
  s.override = {
    word: Object.keys(ROUTES).includes(editing.dmWord) ? editing.dmWord : recommendedRoute(s),
    resource: editing.resourceName,
    url: editing.resourceUrl,
  };
  const t = topicList(s).find((t) => t.id === s.topicId);
  const purpose = ROUTES[s.override.word].purpose;
  const verb = s.ctaAction === "Comment" ? "comment" : "DM";
  const invitation = `If ${t.pain}, ${verb} “${editing.dmWord}” for my ${editing.resourceName}. Use it to ${purpose}.`;
  const replaceInvite = (text) => text.replace(/If [^\n]+, (?:DM|comment) “[^”]+” for my [^\n]+/g, "").trim();
  editing.script = replaceInvite(editing.script);
  editing.caption = replaceInvite(editing.caption);
  if (editing.ctaType === "Spoken resource invitation") editing.script += "\n\n" + invitation;
  editing.caption = editing.ctaType === "Reflective ending" ? invitation + "\n\n" + editing.caption : editing.caption + "\n\n" + invitation;
  editing.closingScreen = `${verb === "comment" ? "Comment" : "DM"} “${editing.dmWord}” · ${editing.resourceName}`;
  editing.carousel = editing.carousel.replace(/Closing slide\n[\s\S]*$/, "Closing slide\n" + editing.closingScreen);
  editing.settings = s;
  openEditor(editing);
  notify("Resource invitation updated in the draft");
}
function savePost(asCopy) {
  collectEditor();
  if (editing.needsDetails && ["Ready", "Published"].includes(editing.status)) {
    notify("Complete the marked prompts before marking this post Ready or Published.");
    return;
  }
  if (editing.resourceUrl && !/^https:\/\//.test(editing.resourceUrl)) {
    notify("Use an HTTPS resource URL.");
    return;
  }
  const p = structuredClone(editing);
  if (asCopy) {
    p.id = newId();
    p.createdAt = new Date().toISOString();
    delete p.history;
  } else {
    // Editing history: keep the previous saved wording when it changes (last 10).
    const prev = state.posts.find((x) => x.id === p.id);
    const snap = (k) => ({ hook: k.hook, script: k.script, caption: k.caption, carousel: k.carousel, closingScreen: k.closingScreen, status: k.status, dmWord: k.dmWord, resourceUrl: k.resourceUrl });
    if (prev && JSON.stringify(snap(prev)) !== JSON.stringify(snap(p)))
      p.history = [...(prev.history || []), { savedAt: prev.updatedAt || prev.createdAt || "", ...snap(prev) }].slice(-10);
  }
  p.updatedAt = new Date().toISOString();
  const i = state.posts.findIndex((x) => x.id === p.id);
  if (i < 0) state.posts.push(p);
  else state.posts[i] = p;
  persist();
  $("editor").close();
  renderPlanner();
  notify(asCopy ? "A new copy is saved. Earlier drafts are unchanged." : "Post saved.");
}
async function copyPart(part) {
  collectEditor();
  const text = part === "complete" ? completePost(editing) : editing[part];
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      $("editor-content").append(helper);
      helper.select();
      const ok = document.execCommand("copy");
      helper.remove();
      if (!ok) throw Error("Copy failed");
    }
    $("copy-result").textContent = "Copied " + (part === "complete" ? "complete post" : part) + ".";
  } catch {
    $("copy-result").textContent = "Clipboard unavailable here. Select the text field and copy manually, or download the complete post.";
    const input = $("e-" + (part === "complete" ? "script" : part));
    input.focus();
    input.select();
  }
}
function backup() {
  return { app: "Boss Clinician Marketing Studio", schemaVersion: 3, exportedAt: new Date().toISOString(), ...structuredClone(state) };
}
function exportBackup() {
  download(
    JSON.stringify(backup(), null, 2),
    "Boss_Clinician_Backup_" + new Date().toISOString().slice(0, 10) + ".json",
    "application/json",
  );
}
function showImportPreview(b) {
  const existing = new Map(state.posts.map((p) => [p.id, p]));
  const changed = b.posts.filter((p) => existing.has(p.id) && JSON.stringify(existing.get(p.id)) !== JSON.stringify(p)).length;
  const duplicate = b.posts.filter((p) => existing.has(p.id) && JSON.stringify(existing.get(p.id)) === JSON.stringify(p)).length;
  $("import-preview").innerHTML =
    `<div class="routebox"><h3>Preview before restoring</h3><p>${b.posts.length} posts · ${b.savedIdeas.length} saved ideas · ${(b.profiles || []).length} saved buyer profiles · ${(b.retreats || []).length} retreat records<br>${changed} conflicting post IDs · ${duplicate} identical posts</p><div class="previewlist">${b.posts
      .slice(0, 8)
      .map((p) => `<div>${esc(p.postingDate || "Unscheduled")} · ${esc(p.pillar)} · ${esc(p.hook)}</div>`)
      .join(
        "",
      )}</div><p class="hint">Incoming audience: ${esc(b.settings.audience || "Not selected")}. No data has been imported yet.</p><label class="field">Restore mode<select id="ms-restore-mode"><option value="merge">Merge · keep existing edits; preserve conflicts as separate copies</option><option value="replace">Replace · replace current saved content and settings</option></select></label><label class="checkline" id="ms-incoming-settings-wrap"><input id="ms-incoming-settings" type="checkbox">Use incoming personalization settings (otherwise keep current settings)</label><label class="checkline hidden" id="ms-replace-confirm-wrap"><input id="ms-replace-confirm" type="checkbox">I confirm: replace my saved ideas, drafts, planner entries, and personalization settings.</label><p class="hint">Merge skips identical post IDs and creates a new copy for conflicting edits. Replace requires confirmation. A recovery snapshot of your current work is kept with your account before replacement.</p><div class="actions"><button class="primary" id="ms-restore-button">Merge backup</button><button class="outline" id="ms-cancel-import">Cancel import</button></div></div>`;
  $("restore-mode").onchange = () => {
    const replace = $("restore-mode").value === "replace";
    $("replace-confirm-wrap").classList.toggle("hidden", !replace);
    $("incoming-settings-wrap").classList.toggle("hidden", replace);
    $("restore-button").textContent = replace ? "Confirm replacement" : "Merge backup";
  };
  $("cancel-import").onclick = () => {
    pendingImport = null;
    $("import-preview").innerHTML = "";
    $("backup-file").value = "";
  };
  $("restore-button").onclick = restoreImport;
}
function restoreImport() {
  if (!pendingImport) return;
  try {
    const replace = $("restore-mode").value === "replace";
    if (replace && !$("replace-confirm").checked) {
      notify("Confirm replacement using the checkbox before replacing saved content.");
      return;
    }
    let message;
    if (replace) {
      recovery = backup();
      sendRecovery = true;
      showRecoveryButton();
      const { app, schemaVersion, exportedAt, ...rest } = structuredClone(pendingImport);
      state = {
        ...rest,
        settings: structuredClone(pendingImport.settings),
        posts: structuredClone(pendingImport.posts),
        savedIdeas: [...pendingImport.savedIdeas],
        legacy: structuredClone(pendingImport.legacy || {}),
        hookEdits: structuredClone(pendingImport.hookEdits || {}),
        customHooks: structuredClone(pendingImport.customHooks || []),
      };
      message = "Backup replaced current content. A recovery snapshot of the previous content is kept with your account.";
    } else {
      const result = mergeBackup(state, pendingImport, $("incoming-settings").checked);
      state = mergeHookTemplates(result.state, pendingImport);
      message = `Merged: ${result.conflicts} conflicting copies preserved; ${result.skipped} identical posts skipped.`;
    }
    persist();
    populate();
    pendingImport = null;
    $("import-preview").innerHTML = '<div class="fit">' + esc(message) + "</div>";
    $("backup-file").value = "";
    notify(message);
  } catch (e) {
    notify(e.message);
  }
}
$("pillar").innerHTML = PILLARS.map((x) => `<option>${x}</option>`).join("");
$("format").innerHTML = FORMATS.map((x) => `<option>${x}</option>`).join("");
$("pillarTag").innerHTML = '<option value="">No pillar</option>' + PILLARS.map((x) => `<option>${x}</option>`).join("");
$("messageFormat").innerHTML = MESSAGE_FORMATS.map((x) => `<option>${x}</option>`).join("");
$("ctaType").innerHTML = ENDINGS.map((x) => `<option>${x}</option>`).join("");
$("format-filter").innerHTML += [...FORMATS].map((x) => `<option>${x}</option>`).join("");
$("audience").onchange = () => {
  $("override-word").value = "";
  updateTopics();
  $("override-resource").value = "";
  $("override-url").value = "";
  $("hook").value = "";
  $("hookTemplateId").value = "";
  for (const k of buyerFields) $(k).value = "";
  refreshMessaging({ profileId: "", angle: "", retreatId: "" });
  updateBuilder();
  persistSettings();
};
$("audienceStage").onchange = () => {
  updateTopics();
  $("hook").value = "";
  $("hookTemplateId").value = "";
  refreshMessaging({ profileId: $("profileId").value, retreatId: "" });
  updateBuilder();
  persistSettings();
};
$("mode").onchange = () => {
  buildOverrideWords();
  updateBuilder();
  persistSettings();
};
$("profileId").onchange = () => {
  // A different buyer: clear the one-off wording typed for the previous one (saved drafts are untouched).
  for (const k of buyerFields) $(k).value = "";
  refreshMessaging({ profileId: $("profileId").value });
  updateBuilder();
  persistSettings();
};
$("retreatId").onchange = () => {
  refreshMessaging({ retreatId: $("retreatId").value });
  updateBuilder();
  persistSettings();
};
$("new-profile").onclick = () => openProfileEditor(null);
$("edit-profile").onclick = () => $("profileId").value && openProfileEditor($("profileId").value);
$("dup-profile").onclick = () => $("profileId").value && openProfileEditor($("profileId").value, true);
$("new-retreat").onclick = () => openRetreatEditor(null);
$("edit-retreat").onclick = () => $("retreatId").value && openRetreatEditor($("retreatId").value);
$("edit-routes").onclick = openRoutesEditor;
for (const k of ["angle", "messageFormat", "ctaAction", "pillarTag", "useCampaignLine", "useTagline", "proofPermission", ...buyerFields])
  $(k).addEventListener("change", () => {
    updateBuilder();
    persistSettings();
  });
for (const k of ["topicId", "pillar", "ctaType", "format", "override-word", "override-resource", "override-url"])
  $(k).addEventListener("change", () => {
    updateBuilder();
    persistSettings();
  });
$("builder").onsubmit = (e) => {
  e.preventDefault();
  const s = settings();
  if (!validate(s)) return;
  persistSettings();
  try {
    openEditor(s.mode === "legacy" ? createPost(s, s.hook) : createMessagePost(s, ctx(s)));
  } catch (err) {
    notify(err.message);
  }
};
$("save-settings").onclick = () => {
  persistSettings();
  notify("Audience and personalization settings saved.");
};
$("create-series").onclick = () => {
  const s = settings();
  if (!validate(s, true)) return;
  try {
    const count = Number($("series-count").value),
      start = $("series-start").value,
      interval = Number($("series-interval").value);
    const entries = series({ ...s, hook: "" }, count, start, interval);
    const seriesId = newId();
    state.posts.push(...entries.map((p) => ({ ...p, seriesId })));
    persistSettings();
    view("planner");
    notify(count + " posts created. Story prompts need your details before publishing.");
  } catch (e) {
    notify(e.message);
  }
};
$("close-editor").onclick = () => {
  $("editor").close();
  editing = null;
};
root.querySelectorAll(".ms-nav button").forEach((b) => (b.onclick = () => view(b.dataset.view)));
$("search").oninput = () => {
  libraryPage = 1;
  renderLibrary();
};
$("format-filter").onchange = () => {
  libraryPage = 1;
  renderLibrary();
};
$("post-search").oninput = renderPlanner;
for (const id of ["csv-export", "planner-export2"])
  $(id).onclick = () => download(toCSV(sortedPosts()), "Boss_Clinician_Content_Planner.csv", "text/csv;charset=utf-8");
$("json-export").onclick = exportBackup;
$("backup-file").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw Error("Choose a JSON backup smaller than 20 MB.");
    pendingImport = validateBackup(JSON.parse(await file.text()));
    showImportPreview(pendingImport);
  } catch (err) {
    pendingImport = null;
    $("import-preview").innerHTML = '<p class="error">' + esc(err.message) + "</p>";
  }
};
function showRecoveryButton() {
  if (!recovery || $("recovery-download")) return;
  const recoveryButton = document.createElement("button");
  recoveryButton.className = "outline";
  recoveryButton.id = "ms-recovery-download";
  recoveryButton.textContent = "Download pre-replacement recovery backup";
  recoveryButton.onclick = () => download(JSON.stringify(recovery, null, 2), "Boss_Clinician_Recovery.json", "application/json");
  $("json-export").parentElement.append(recoveryButton);
}
showRecoveryButton();
$("series-start").value = new Date().toISOString().slice(0, 10);
populate();
renderLibrary();

function renderInsights() {
  $("insight-grid").innerHTML = COACHING_INSIGHTS.map(
    (p) =>
      `<article class="card"><div class="thumb">${esc(p.contentLabel || p.pillar)}</div><div class="cardbody"><div class="meta">${esc(p.audience)} · ${esc(p.audienceStage)}</div><h3>${esc(p.hook)}</h3><p class="hint">${esc(p.topic)} · ${esc(p.format)}</p><button class="textbtn" data-insight="${esc(p.id)}">Open full draft →</button></div></article>`,
  ).join("");
  $("insight-grid")
    .querySelectorAll("[data-insight]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const p = state.posts.find((p) => p.id === b.dataset.insight) || COACHING_INSIGHTS.find((p) => p.id === b.dataset.insight);
          openEditor(p);
        }),
    );
}
$("add-insights").onclick = () => {
  const before = state.posts.length;
  state.posts = addCoachingInsights(state.posts);
  persist();
  view("planner");
  notify(state.posts.length - before + " coaching posts added. Existing drafts kept.");
};
renderInsights();


/* ---- Hook templates managed by the owner (brief §5) ---------------------
   The 365 evergreen templates stay in hooks.ts. Her changes are stored beside
   them: `hookEdits[id]` overrides wording, pillar or focus and can archive a
   template; `customHooks` holds templates she adds. Archiving only hides a
   template from the library: posts already made from it keep their own copy
   of the hook text, so nothing created earlier changes. */
function allHooks() {
  const edits = state.hookEdits || {};
  return [
    ...HOOKS.map((h) => (edits[h.id] ? { ...h, ...edits[h.id], id: h.id, day: h.day, edited: true } : h)),
    ...(state.customHooks || []).map((h) => ({ ...h, custom: true })),
  ];
}
function mergeHookTemplates(merged, incoming) {
  const out = { ...merged };
  // Keep her current wording for any template she has edited here; take the
  // incoming change only for templates untouched in this copy.
  out.hookEdits = { ...(incoming.hookEdits || {}), ...(state.hookEdits || {}) };
  const byId = new Map((state.customHooks || []).map((h) => [h.id, h]));
  for (const h of incoming.customHooks || []) if (h && typeof h.id === "number" && !byId.has(h.id)) byId.set(h.id, h);
  out.customHooks = [...byId.values()];
  // Buyer profiles and retreat records: keep her copy of any id she has; add the rest.
  for (const key of ["profiles", "retreats"]) {
    if (!state[key] && !incoming[key]) continue;
    const mine = new Map((state[key] || []).map((x) => [x.id, x]));
    for (const x of incoming[key] || []) if (x && typeof x.id === "string" && !mine.has(x.id)) mine.set(x.id, x);
    out[key] = [...mine.values()];
  }
  for (const key of ["retreatMessaging", "routeEdits"]) {
    if (state[key] !== undefined) out[key] = state[key];
    else if (incoming[key] !== undefined) out[key] = structuredClone(incoming[key]);
  }
  return out;
}
function openHookEditor(id) {
  const isNew = id == null;
  const h = isNew ? { hook: "", pillar: PILLARS[0], focus: "", archived: false } : allHooks().find((x) => x.id === id);
  if (!h) return;
  editing = null;
  $("editor-content").innerHTML =
    `<span class="tag">${isNew ? "New hook template" : h.custom ? "Your template" : "Evergreen template " + esc(h.day)}</span><h2 id="ms-editor-title">${isNew ? "Add a hook template" : "Edit hook template"}</h2><p class="hint">Use [topic] where the chosen topic should go. Posts already created from this template keep their own text.</p><div class="formgrid" style="margin-top:18px"><label class="field">Pillar<select id="ms-h-pillar">${PILLARS.map((x) => `<option ${h.pillar === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label class="field">Focus (optional)<input id="ms-h-focus" value="${esc(h.focus)}"></label><label class="field wide">Hook wording<textarea id="ms-h-hook">${esc(h.hook)}</textarea></label></div>${isNew ? "" : `<label class="checkline"><input type="checkbox" id="ms-h-archived" ${h.archived ? "checked" : ""}>Archived · hide from the hook library (existing posts are kept)</label>`}<div class="actions"><button class="primary" id="ms-h-save">${isNew ? "Add template" : "Save template"}</button>${!isNew && !h.custom && h.edited ? '<button class="outline" id="ms-h-reset">Restore original wording</button>' : ""}</div>`;
  $("h-save").onclick = () => {
    const hook = $("h-hook").value.trim();
    if (!hook) {
      notify("Enter the hook wording.");
      return;
    }
    const fields = { hook, pillar: $("h-pillar").value, focus: $("h-focus").value.trim(), archived: $("h-archived")?.checked || false };
    if (isNew) {
      const ids = allHooks().map((x) => x.id);
      const newIdNum = Math.max(900000, ...ids) + 1;
      state.customHooks.push({ id: newIdNum, day: HOOKS.length + state.customHooks.length + 1, ...fields, createdAt: new Date().toISOString() });
    } else if (h.custom) {
      state.customHooks = state.customHooks.map((x) => (x.id === id ? { ...x, ...fields, updatedAt: new Date().toISOString() } : x));
    } else {
      state.hookEdits[id] = { ...fields, updatedAt: new Date().toISOString() };
    }
    persist();
    $("editor").close();
    renderLibrary();
    renderSaved();
    notify(isNew ? "Hook template added." : fields.archived ? "Template archived. Posts made from it are unchanged." : "Hook template saved.");
  };
  if ($("h-reset"))
    $("h-reset").onclick = () => {
      delete state.hookEdits[id];
      persist();
      $("editor").close();
      renderLibrary();
      renderSaved();
      notify("Original wording restored.");
    };
  if (!$("editor").open) $("editor").showModal();
}
$("add-hook").onclick = () => openHookEditor(null);
$("show-archived").onchange = () => {
  showArchived = $("show-archived").checked;
  libraryPage = 1;
  renderLibrary();
};

/* ---- Messaging-first workflow (addenda of 20/21 Nov 2026) ----------------
   Function declarations only: populate() runs above and relies on hoisting. */
function ctx(s = settings()) {
  return {
    profile: allProfiles(state).find((p) => p.id === s.profileId && p.audience === s.audience),
    retreat: allRetreats(state).find((r) => r.id === s.retreatId),
    messaging: retreatMessaging(state),
    routeEdits: state.routeEdits || {},
  };
}
function fillSelect(el, items, selected, empty) {
  el.innerHTML = (empty ? `<option value="">${esc(empty)}</option>` : "") + items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  el.value = items.some(([v]) => v === selected) ? selected : items[0]?.[0] || "";
}
/** Rebuilds the profile, angle and retreat choices for the chosen audience. */
function refreshMessaging(sel = {}) {
  const a = $("audience").value,
    stage = $("audienceStage").value;
  const profiles = profilesFor(state, a, stage);
  fillSelect($("profileId"), profiles.map((p) => [p.id, p.name + (p.edited ? " · edited" : "")]), sel.profileId ?? $("profileId").value, profiles.length ? "" : "No saved profile yet — create one");
  if (profiles.length && !$("profileId").value) $("profileId").value = profiles[0].id;
  const angles = anglesFor(a);
  fillSelect($("angle"), angles.map((x) => [x.id, x.label]), sel.angle ?? $("angle").value);
  const retreats = a === RETREAT_AUDIENCE ? retreatsFor(state, stage) : [];
  fillSelect($("retreatId"), retreats.map((r) => [r.id, r.name]), sel.retreatId ?? $("retreatId").value, retreats.length ? "" : "No retreat of this type yet — add one");
  if (retreats.length && !$("retreatId").value) $("retreatId").value = retreats[0].id;
  const prof = profiles.find((p) => p.id === $("profileId").value);
  $("symptom-list").innerHTML = String(prof?.symptoms || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<option value="${esc(x)}"></option>`)
    .join("");
  const short = (t) => (String(t || "").length > 90 ? String(t).slice(0, 88) + "…" : String(t || ""));
  $("pointA").placeholder = prof?.pointA ? "From the profile: " + short(prof.pointA) : "What they would say is wrong, in their words";
  $("pointB").placeholder = prof?.microMoment || prof?.pointB ? "From the profile: " + short(prof.microMoment || prof.pointB) : "The concrete moment they are hoping for";
  $("beliefShift").placeholder = prof?.beliefGap ? "From the profile: " + short(prof.beliefGap) : "One point of view this post makes";
  $("symptom").placeholder = prof?.symptoms ? "Pick one from the profile, or describe one moment" : "Describe one specific moment in their week";
}
function renderBuyerPanels(s, c) {
  const prof = c.profile;
  $("profile-summary").innerHTML = prof
    ? `<div class="profilecard"><b>${esc(prof.name)}</b><p>${esc(prof.who)}</p><p class="hint">Point A: “${esc(prof.pointA)}”${prof.microMoment || prof.pointB ? "<br>Point B: " + esc(prof.microMoment || prof.pointB) : ""}${prof.note ? "<br>" + esc(prof.note) : ""}</p>${prof.genericExample && prof.specificExample ? `<details><summary class="textbtn">Generic vs. specific</summary><p class="hint"><b>Generic:</b> “${esc(prof.genericExample)}”<br><b>Specific:</b> “${esc(prof.specificExample)}”<br>An illustration, not a documented customer result.</p></details>` : ""}</div>`
    : s.audience
      ? '<p class="hint">Choose a saved buyer profile, or create one, before generating.</p>'
      : "";
  if (s.audience !== RETREAT_AUDIENCE) return;
  const m = c.messaging;
  $("fh-box").innerHTML = `<div class="routebox"><b>FlourisHealer core message</b><p>“${esc(m.coreMessage)}”</p><p class="hint">For women mental health professionals and wellness providers.<br>Campaign line (optional): “${esc(m.campaignLine)}” · Tagline (optional brand flourish, never the opening hook): “${esc(m.tagline)}”</p><details><summary class="textbtn">Long-form brand description and approved sample copy</summary><p class="pre">${esc(m.brandDescription)}</p><p class="hint"><b>Sample hook:</b> “${esc(m.sampleHook)}”<br><b>Sample body:</b> “${esc(m.sampleBody)}”<br><b>Sample CTA:</b> “${esc(m.sampleCta)}”<br>Illustrative promotional copy, not a client testimonial.</p></details><button class="textbtn" type="button" id="ms-edit-fh">Edit FlourisHealer messaging</button></div>`;
  $("edit-fh").onclick = openFhEditor;
  const r = c.retreat;
  if (!r) {
    $("retreat-summary").innerHTML = "";
    return;
  }
  const facts = RETREAT_FACT_FIELDS.filter(([k]) => String(r[k] || "").trim()).map(([k, l]) => `${esc(l)}: ${esc(r[k])}`);
  const missing = missingRetreatFacts(r);
  $("retreat-summary").innerHTML = `<div class="profilecard"><b>${esc(r.name)}</b> · ${esc(RETREAT_TYPES[r.type] || r.type)}<p class="hint">${facts.length ? facts.join("<br>") : "No verified details entered yet."}${r.type === "domestic" ? `<br>Promise: ${r.promise ? esc(r.promise) + (r.promiseConfirmed ? " (confirmed)" : " (not yet confirmed)") : "not entered"}` : ""}<br>Destination: ${safeLink(r.url || ROUTES.RETREAT.url)}</p>${missing.length ? `<p class="warning">Needs details: ${esc(missing.join(", "))}. Generated posts will not mention these until you add them.</p>` : ""}</div>`;
}
function messageMeta(p) {
  if (p.mode !== "messaging") return "";
  const rows = [
    ["Buyer profile", p.profileName],
    ["WHO", p.who],
    ["Point A", p.pointA],
    ["Symptom", (p.symptoms || []).join("; ")],
    ["Point B", p.pointB],
    ["Main idea", p.mainIdea],
    ["Angle", p.angleLabel],
    ["Retreat", p.retreatName ? `${p.retreatName} · ${RETREAT_TYPES[p.retreatType] || ""}` : ""],
    ["Proof provenance", p.proofProvenance],
  ].filter(([, v]) => v);
  return `<div class="profilecard"><b>Message behind this draft</b><p class="hint">${rows.map(([l, v]) => `${esc(l)}: ${esc(v)}`).join("<br>")}</p>${p.missingDetails?.length ? `<p class="warning">Needs details in the retreat record: ${esc(p.missingDetails.join(", "))}.</p>` : ""}<p class="hint">Editing your profiles later does not change this draft.</p></div>`;
}
function numberedPoints(p) {
  return String(p.script || "")
    .split("\n")
    .filter((l) => /^\s*\d+[.)]\s/.test(l)).length;
}
function qualityBlock(p) {
  const items = reviewPost(p);
  const flags = items.filter((x) => !x.ok).length;
  return `<details class="review" ${p.mode === "messaging" ? "open" : ""}><summary class="textbtn">Message Quality Review · ${flags ? flags + " to look at" : "nothing flagged"}</summary><ul class="reviewlist">${items
    .map((x) => `<li class="${x.ok ? "ok" : "flag"}"><b>${x.ok ? "✓" : "!"} ${esc(x.label)}</b>${x.ok ? "" : " · " + esc(x.fix)}</li>`)
    .join("")}</ul><label class="checkline"><input type="checkbox" id="ms-e-qualityReviewed" ${p.qualityReviewed ? "checked" : ""}>I’ve reviewed these flags. They are suggestions and never block saving.</label></details>`;
}
/** "Apply resource fields to invitations" for a messaging-first draft. */
function applyMessageResource(old) {
  const routes = routeTable(state.routeEdits);
  const word = editing.dmWord.trim(),
    action = editing.ctaAction === "DM" ? "DM" : "Comment",
    base = routes[word];
  const line = base && base.resource === editing.resourceName ? (action === "DM" ? base.dmLine : base.line) : `${action} ${word} for my ${editing.resourceName}.`;
  const prev = editing.ctaLine || "",
    prefix = (prev.match(/^If [^:\n]+: /) || [""])[0],
    next = prefix + line,
    missed = [];
  for (const f of ["script", "caption"]) {
    if (prev && editing[f].includes(prev)) editing[f] = editing[f].split(prev).join(next);
    else if (f === "caption" || editing.ctaType === "Spoken resource invitation") missed.push(f);
  }
  if (old.resourceUrl && old.resourceUrl !== editing.resourceUrl) editing.caption = editing.caption.split(old.resourceUrl).join(editing.resourceUrl);
  editing.closingScreen = `${action} ${word} · ${editing.resourceName}`;
  if (editing.carousel) editing.carousel = editing.carousel.replace(/Closing slide\n[\s\S]*$/, "Closing slide\n" + editing.closingScreen);
  editing.ctaLine = next;
  openEditor(editing);
  notify(missed.length ? `Closing screen updated. The invitation in your ${missed.join(" and ")} was edited by hand, so change it there directly.` : "Resource invitation updated in the draft.");
}
function dialogField(id, label, value, { area = false, hint = "", type = "text" } = {}) {
  return `<label class="field ${area ? "wide" : ""}">${esc(label)}${area ? `<textarea data-f="${id}">${esc(value)}</textarea>` : `<input data-f="${id}" type="${type}" value="${esc(value)}">`}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</label>`;
}
function dialogValues() {
  const out = {};
  for (const el of $("editor-content").querySelectorAll("[data-f]")) out[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value.trim();
  return out;
}
function openProfileEditor(id, duplicate = false) {
  const found = id ? allProfiles(state).find((x) => x.id === id) : null;
  const isNew = !found || duplicate;
  const p = duplicate
    ? duplicateProfile(found)
    : found || { id: "profile-" + newId(), audience: $("audience").value || "Club", stage: $("audience").value === "Boardroom" || $("audience").value === RETREAT_AUDIENCE ? $("audienceStage").value : "" };
  editing = null;
  const stageOpts = [["", "Any stage"], ["first", "Boardroom: preparing to hire"], ["team", "Boardroom: leading a team"], ["international", "Retreat: international reset"], ["domestic", "Retreat: domestic business retreat"]];
  $("editor-content").innerHTML = `<span class="tag">${duplicate ? "Copy of " + esc(found.name) : isNew ? "New buyer profile" : p.builtIn ? "Starter profile" : "Your profile"}</span><h2 id="ms-editor-title">${isNew ? "Create a buyer messaging profile" : "Edit buyer messaging profile"}</h2><p class="hint">Work through the steps in order. Profiles never change drafts you have already made. Sensitive details are optional: describe a type of person, never a real prospect’s identity or health information.</p><div class="formgrid" style="margin-top:18px"><label class="field">Audience<select data-f="audience">${AUDIENCES.map((a) => `<option ${p.audience === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></label><label class="field">Stage / retreat type<select data-f="stage">${stageOpts.map(([v, l]) => `<option value="${v}" ${(p.stage || "") === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>${PROFILE_FIELDS.map(([k, label, hint]) => dialogField(k, label, p[k], { area: !["name", "pointA"].includes(k), hint })).join("")}</div>${p.note ? `<p class="hint">Note: ${esc(p.note)}</p>` : ""}${isNew ? "" : `<label class="checkline"><input type="checkbox" data-f="archived" ${p.archived ? "checked" : ""}>Archived · hide from the profile list (drafts made with it are kept)</label>`}<div class="actions"><button class="primary" id="ms-p-save">${isNew ? "Save profile" : "Save changes"}</button>${!isNew && p.builtIn && p.edited ? '<button class="outline" id="ms-p-reset">Restore starter wording</button>' : ""}</div>`;
  $("p-save").onclick = () => {
    const v = dialogValues();
    if (!v.name || !v.who) {
      notify("Give the profile a name and describe WHO it is for.");
      return;
    }
    const okStage = v.audience === "Boardroom" ? ["", "first", "team"] : v.audience === RETREAT_AUDIENCE ? ["", "international", "domestic"] : [""];
    if (!okStage.includes(v.stage)) {
      notify("That stage does not belong to the chosen audience.");
      return;
    }
    const { builtIn, edited, ...base } = p;
    const record = { ...base, ...v, archived: !!v.archived, id: p.id, createdAt: p.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.profiles = upsertById(state.profiles, record);
    persist();
    $("editor").close();
    refreshMessaging({ profileId: record.archived ? "" : record.id });
    updateBuilder();
    if (!record.archived && $("profileId").value === record.id) persistSettings();
    notify(record.archived ? "Profile archived. Drafts made with it are unchanged." : "Profile saved. Existing drafts are unchanged.");
  };
  if ($("p-reset"))
    $("p-reset").onclick = () => {
      state.profiles = (state.profiles || []).filter((x) => x.id !== p.id);
      persist();
      $("editor").close();
      refreshMessaging({});
      updateBuilder();
      notify("Starter wording restored.");
    };
  if (!$("editor").open) $("editor").showModal();
}
function openRetreatEditor(id) {
  const found = id ? allRetreats(state).find((x) => x.id === id) : null;
  const r = found || { id: "retreat-" + newId(), type: $("audienceStage").value || "international", name: "", url: ROUTES.RETREAT.url };
  editing = null;
  $("editor-content").innerHTML = `<span class="tag">${found ? "Retreat record" : "New retreat record"}</span><h2 id="ms-editor-title">${found ? "Edit " + esc(r.name) : "Add a retreat"}</h2><p class="hint">Enter only facts you have verified for this retreat. Anything left blank is shown as “Needs details” and never written into a post.</p><div class="formgrid" style="margin-top:18px">${dialogField("name", "Retreat name", r.name)}<label class="field">Retreat type<select data-f="type">${Object.entries(RETREAT_TYPES).map(([v, l]) => `<option value="${v}" ${r.type === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>${dialogField("url", "Destination URL", r.url, { type: "url", hint: "Default: the existing /retreats page. Use a destination-specific page only when it exists." })}${dialogField("promise", "The retreat’s actual promise (required for domestic retreats)", r.promise, { area: true, hint: "e.g. the professional-development goal of a domestic business retreat." })}<label class="checkline wide"><input type="checkbox" data-f="promiseConfirmed" ${r.promiseConfirmed ? "checked" : ""}>I confirm this promise and these inclusions are accurate for this retreat.</label>${RETREAT_FACT_FIELDS.map(([k, l]) => dialogField(k, l, r[k], { area: ["itinerary", "inclusions", "deposit"].includes(k) })).join("")}${dialogField("note", "Internal note (not used in posts)", r.note, { area: true })}</div>${found ? `<label class="checkline"><input type="checkbox" data-f="archived" ${r.archived ? "checked" : ""}>Archived · hide from the retreat list (posts are kept)</label>` : ""}<div class="actions"><button class="primary" id="ms-r-save">Save retreat</button>${found?.builtIn && found?.edited ? '<button class="outline" id="ms-r-reset">Restore starter record</button>' : ""}</div>`;
  $("r-save").onclick = () => {
    const v = dialogValues();
    if (!v.name) {
      notify("Name the retreat.");
      return;
    }
    if (v.url && !/^https:\/\//.test(v.url)) {
      notify("Use an HTTPS destination URL.");
      return;
    }
    const { builtIn, edited, ...base } = r;
    const record = { ...base, ...v, archived: !!v.archived, id: r.id, createdAt: r.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.retreats = upsertById(state.retreats, record);
    persist();
    $("editor").close();
    refreshMessaging({ retreatId: record.archived ? "" : record.id });
    updateBuilder();
    notify("Retreat saved. Existing posts are unchanged.");
  };
  if ($("r-reset"))
    $("r-reset").onclick = () => {
      state.retreats = (state.retreats || []).filter((x) => x.id !== r.id);
      persist();
      $("editor").close();
      refreshMessaging({});
      updateBuilder();
      notify("Starter retreat record restored.");
    };
  if (!$("editor").open) $("editor").showModal();
}
function openFhEditor() {
  const m = retreatMessaging(state);
  editing = null;
  const f = [
    ["coreMessage", "Core message", false],
    ["brandDescription", "Longer brand description", true],
    ["campaignLine", "Campaign line (optional in posts)", false],
    ["tagline", "Tagline (optional brand flourish)", false],
    ["sampleHook", "Sample hook", true],
    ["sampleBody", "Sample body", true],
    ["sampleCta", "Sample CTA", false],
  ];
  $("editor-content").innerHTML = `<span class="tag">FlourisHealer Retreats</span><h2 id="ms-editor-title">FlourisHealer messaging</h2><p class="hint">Four separate fields: none is merged into one slogan. Changes apply to new posts only.</p><div class="formgrid" style="margin-top:18px">${f.map(([k, l, a]) => dialogField(k, l, m[k], { area: a })).join("")}</div><div class="actions"><button class="primary" id="ms-fh-save">Save messaging</button>${state.retreatMessaging ? '<button class="outline" id="ms-fh-reset">Restore approved wording</button>' : ""}</div>`;
  $("fh-save").onclick = () => {
    const v = dialogValues();
    if (!v.coreMessage) {
      notify("Keep a core message.");
      return;
    }
    const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== RETREAT_MESSAGING[k]));
    if (Object.keys(changed).length || state.retreatMessaging) state.retreatMessaging = changed;
    persist();
    $("editor").close();
    updateBuilder();
    notify("FlourisHealer messaging saved. Existing posts are unchanged.");
  };
  if ($("fh-reset"))
    $("fh-reset").onclick = () => {
      delete state.retreatMessaging;
      persist();
      $("editor").close();
      updateBuilder();
      notify("Approved wording restored.");
    };
  if (!$("editor").open) $("editor").showModal();
}
function openRoutesEditor() {
  const current = routeTable(state.routeEdits),
    defaults = routeTable({});
  editing = null;
  $("editor-content").innerHTML = `<span class="tag">Resource routes</span><h2 id="ms-editor-title">Resource links and CTA wording</h2><p class="hint">One keyword per resource. Changes apply to new posts. Saved drafts keep their links until you use “Apply resource fields to invitations” inside a draft. There is no MARKETING keyword: marketing and niche posts use NICHE.</p>${Object.entries(current)
    .map(
      ([w, r]) =>
        `<fieldset class="routeset"><legend>${esc(w)} · ${esc(r.audience)}</legend><div class="formgrid">${dialogField(w + ".resource", "Resource name", r.resource)}${dialogField(w + ".url", "Destination URL", r.url, { type: "url" })}${dialogField(w + ".line", "Comment invitation", r.line, { area: true })}${dialogField(w + ".dmLine", "DM invitation (only if DM automation is set up)", r.dmLine, { area: true })}</div></fieldset>`,
    )
    .join("")}<div class="actions"><button class="primary" id="ms-routes-save">Save resource settings</button></div>`;
  $("routes-save").onclick = () => {
    const v = dialogValues(),
      edits = {};
    for (const [key, val] of Object.entries(v)) {
      const [w, f] = key.split(".");
      if (f === "url" && val && !/^https:\/\//.test(val)) {
        notify(`Use an HTTPS URL for ${w}.`);
        return;
      }
      if (val && val !== defaults[w][f]) (edits[w] ||= {})[f] = val;
    }
    if (Object.keys(edits).length || state.routeEdits) state.routeEdits = edits;
    persist();
    $("editor").close();
    updateBuilder();
    notify("Resource settings saved. Existing drafts are unchanged.");
  };
  if (!$("editor").open) $("editor").showModal();
}

return {
  flush,
  destroy() {
    clearTimeout(toastTimer);
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (dirty && !stopped) void flush();
    if ($("editor")?.open) $("editor").close();
    root.innerHTML = "";
  },
};
}
