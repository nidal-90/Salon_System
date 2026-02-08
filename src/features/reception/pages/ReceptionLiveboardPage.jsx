// src/features/reception/pages/ReceptionLiveboardPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import styles from "./ReceptionLiveboardPage.module.css";

/* =========================
   Helpers
========================= */
function safeStr(x) {
  return String(x == null ? "" : x).trim();
}

function fmtClock(iso) {
  const s = safeStr(iso);
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Duration: always show seconds */
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}
function formatEUR(n) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
  } catch {
    return `${v.toFixed(2)} €`;
  }
}

// live tick as epoch ms (for modal timers)
function useNowTick(enabled) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return now;
}

function msBetween(aIso, bIso, fallbackMs = 0) {
  const a = safeStr(aIso);
  const b = safeStr(bIso);
  if (!a || !b) return fallbackMs;
  const A = new Date(a).getTime();
  const B = new Date(b).getTime();
  if (!Number.isFinite(A) || !Number.isFinite(B)) return fallbackMs;
  return Math.max(0, B - A);
}

function statusLabel(st) {
  const s = String(st || "");
  if (s === "waiting") return "Wartend";
  if (s === "active") return "In Behandlung";
  if (s === "done") return "Checkout";
  return "—";
}

function nextDir(dir) {
  return dir === "asc" ? "desc" : "asc";
}
function cmp(a, b) {
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function useUsbStaffFallback() {
  try {
    const raw = sessionStorage.getItem("usb_session");
    if (!raw) return { staffId: "", staffName: "" };
    const s = JSON.parse(raw);
    return { staffId: s?.staffId || "", staffName: s?.staffName || s?.name || "" };
  } catch {
    return { staffId: "", staffName: "" };
  }
}

async function logCustomerTimerToHistory({
  customerId,
  visitId,
  areaId,
  areaName,
  staffId,
  staffName,
  type,
  startedAt,
  endedAt,
  durationMs,
}) {
  if (!customerId) return;
  try {
    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: String(customerId),
      createdAt: new Date().toISOString(),
      visitId: String(visitId || ""),
      areaId: String(areaId || ""),
      staffId: String(staffId || ""),
      staffName: String(staffName || ""),
      type: String(type || "TIMER"),
      payload: {
        areaName: String(areaName || ""),
        startedAt: String(startedAt || ""),
        endedAt: String(endedAt || ""),
        durationMs: Number(durationMs || 0),
      },
    });
  } catch {
    // must not block UX
  }
}

/* =========================
   Data shaping helpers
========================= */

/** check-in start: should be visit.createdAt, fallback state row */
function inferCheckInAt(visit, stateRow) {
  const v1 = safeStr(visit?.createdAt);
  if (v1) return v1;
  const v2 = safeStr(visit?.checkInAt);
  if (v2) return v2;
  const v3 = safeStr(stateRow?.createdAt);
  if (v3) return v3;
  return new Date().toISOString();
}

/** active start: prefer row.startedAt */
function inferActiveStart({ status, row, visit, services }) {
  const direct = safeStr(row?.startedAt);
  if (direct) return direct;

  if (status === "active" || status === "done") {
    const sv = (services || [])
      .map((x) => safeStr(x.startedAt))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (sv.length) return sv[0];
    return safeStr(visit?.createdAt);
  }
  return "";
}

/** Group label: visit.displayName is already groupDisplayName in your orderApi. */
function inferGroupLabel(visit) {
  if (!visit) return "";
  if (String(visit.type || "") !== "group") return "";
  const dn = safeStr(visit.displayName);
  return dn || "";
}

/** Participant label: primary member displayName OR role-specific member (we show "who is sitting") */
function inferParticipantLabel(visit, memberPrimary) {
  const mp = safeStr(memberPrimary?.displayName);
  if (mp) return mp;
  // fallback: if visit.displayName contains participant too (older data)
  return "";
}

/* =========================
   Component
========================= */
export default function ReceptionLiveboardPage() {
  const nav = useNavigate();
  const usb = useUsbStaffFallback();

  const [tab, setTab] = useState("waiting"); // waiting | active | checkout
  const [dateKey, setDateKey] = useState(() => toDateKeyISO(new Date()));

  const [areas, setAreas] = useState([]);
  const [staff, setStaff] = useState([]);

  // LEFT FILTERS
  const [selectedAreaIds, setSelectedAreaIds] = useState(new Set()); // empty => all
  const [selectedNames, setSelectedNames] = useState(new Set()); // empty => all
  const [selectedPreferredStaff, setSelectedPreferredStaff] = useState(new Set()); // empty => all
  const [nameFilterQ, setNameFilterQ] = useState("");
  const [prefStaffFilterQ, setPrefStaffFilterQ] = useState("");

  // board rows
  const [rows, setRows] = useState([]); // enriched state rows
  const [searchName, setSearchName] = useState("");

  const [activeStaffId, setActiveStaffId] = useState(() => usb.staffId || "");
  const [busyId, setBusyId] = useState("");
  const [toast, setToast] = useState("");

  // sorting (main)
  const [sort, setSort] = useState({ key: "timer", dir: "desc" });

  // overlay sorting
  const [overlaySort, setOverlaySort] = useState({ key: "timer", dir: "desc" });

  // overlay (KPI tables) + centered status modal
  const [overlay, setOverlay] = useState({ open: false, title: "", mode: "", items: [], tone: "waiting" });
  const [statusModal, setStatusModal] = useState({ open: false, visitId: "" });

  // Customer Modal (name click)
  // tabs: profile | history | today
  const [customerModal, setCustomerModal] = useState({
    open: false,
    visitId: "",
    customerId: "",
    title: "",
    groupLabel: "",
    participantLabel: "",
    tab: "profile",
    profile: null,
    history: [], // older visits
    today: { services: [], products: [], notesByArea: [], preferredByArea: [] }, // today items from this visit
    liveboard: [],
    members: [],
  });

  // Premium “Kundenkarte” Modal (für Name-Click UND Aktion-Click)
const [visitSheet, setVisitSheet] = useState({
  open: false,
  mode: "", // "waiting" | "active" | "checkout"
  rowId: "",
  visitId: "",
  areaId: "",
  title: "",
  sub: "",
  status: "",
  checkInAt: "",
  waitingSince: "",
  activeSince: "",
  areaName: "",
  wishServiceTitle: "",
  preferredStaffName: "",
  assignedStaffName: "",
  note: "",
  services: [],
  products: [],
  members: [],
  profile: null,
  history: [],
  liveboard: [],
  staffValue: "",
});

function closeVisitSheet() {
  setVisitSheet((s) => ({ ...s, open: false }));
}

// lädt deine bestehenden Daten (profil/history/today/liveboard/members) + baut “ViewModel”
async function openVisitSheetFromRow(rowOrCheckout, modeHint = "") {
  const visitId = String(rowOrCheckout?.visitId || "");
  if (!visitId) return;

  const visit = await db.visits.get(visitId).catch(() => null);
  const customerId = visit?.customerId ? String(visit.customerId) : "";

  const title =
    safeStr(visit?.displayName) ||
    safeStr(rowOrCheckout?.displayName) ||
    safeStr(rowOrCheckout?._displayName) ||
    `Visit ${visitId.slice(-6)}`;

  const isCheckout = !!rowOrCheckout?.checkoutAt;
  const status = isCheckout ? "checkout" : safeStr(rowOrCheckout?._status) || safeStr(modeHint) || "";

  // “Subline”: Gruppe/Teilnehmer (ohne Liste zu überladen)
  const isGroup = String(visit?.type || "") === "group";
  const sub = isGroup ? "Gruppe" : (safeStr(rowOrCheckout?._displaySub) || "");

  // Services/Products/AreaState für HEUTE (Visit)
  let todayServices = [];
  let todayProducts = [];
  let notesByArea = [];
  let preferredByArea = [];
  let liveboard = [];
  let members = [];

  try {
    const [vs, vp, vas] = await Promise.all([
      db.visit_services.where("visitId").equals(visitId).toArray().catch(() => []),
      db.visit_products.where("visitId").equals(visitId).toArray().catch(() => []),
      db.visit_area_state.where("visitId").equals(visitId).toArray().catch(() => []),
    ]);

    todayServices = (vs || []).map((s) => ({
      title: safeStr(s.title),
      price: Number(s.price || 0) || 0,
      areaId: String(s.areaId || ""),
      memberId: safeStr(s.memberId),
      note: safeStr(s.note),
    }));

    todayProducts = (vp || []).map((p) => ({
      title: safeStr(p.title),
      qty: Number(p.qty || 1) || 1,
      price: Number(p.price || 0) || 0,
      memberId: safeStr(p.memberId),
    }));

    notesByArea = (vas || [])
      .map((r) => ({
        areaId: String(r.areaId || ""),
        areaName: safeStr(areas.find((a) => String(a.id) === String(r.areaId))?.name) || safeStr(r.areaName) || "Bereich",
        note: safeStr(r.note),
      }))
      .filter((x) => !!x.note);

    preferredByArea = (vas || [])
      .map((r) => ({
        areaId: String(r.areaId || ""),
        areaName: safeStr(areas.find((a) => String(a.id) === String(r.areaId))?.name) || safeStr(r.areaName) || "Bereich",
        preferred: safeStr(r.preferredStaffName) || "—",
        assigned: safeStr(r.assignedStaffName) || "—",
        status: safeStr(r.status),
        startedAt: safeStr(r.startedAt),
        endedAt: safeStr(r.endedAt),
      }))
      .filter((x) => x.areaId);

    liveboard = (liveRows || [])
      .filter((r) => String(r.visitId || "") === visitId)
      .map((r) => ({
        id: String(r.id),
        areaId: String(r.areaId || ""),
        areaName: safeStr(r._areaName),
        status: safeStr(r._status),
        waitingMs: Number(r._waitingMs || 0),
        activeMs: Number(r._activeMs || 0),
        staff: safeStr(r._assignedStaffName) || safeStr(r._preferredStaffName) || "",
        checkInAt: safeStr(r._checkInAt),
        activeSince: safeStr(r._activeSince),
      }))
      .sort((a, b) => String(a.areaName).localeCompare(String(b.areaName)));

  } catch {
    // ignore
  }

  try {
    if ((db?.tables || []).some((t) => t?.name === "visit_members")) {
      const mm = await db.visit_members.where("visitId").equals(visitId).toArray().catch(() => []);
      members = (mm || [])
        .map((x) => safeStr(x.displayName) || safeStr(x.name) || safeStr(x.phone))
        .filter(Boolean);
    }
  } catch {
    members = [];
  }

  // Profile
  let profile = null;
  try {
    if (customerId && (db?.tables || []).some((t) => t?.name === "customers")) {
      profile = await db.customers.get(customerId).catch(() => null);
    }
  } catch {
    profile = null;
  }
  const finalProfile = profile
    ? { ...profile, displayName: safeStr(profile.displayName) || title }
    : { id: customerId, displayName: title, phone: "", instagram: "", email: "" };

  // History (alte Visits)
  let history = [];
  try {
    if (customerId) {
      const all = await db.visits.where("customerId").equals(customerId).toArray().catch(() => []);
      history = (all || [])
        .filter((v) => String(v.id || "") !== visitId)
        .map((v) => ({
          visitId: String(v.id || ""),
          dateKey: safeStr(v.dateKey),
          createdAt: safeStr(v.createdAt),
          note: safeStr(v.note || v.comment || ""),
          type: safeStr(v.type || ""),
          status: safeStr(v.status || ""),
        }))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 60);
    }
  } catch {
    history = [];
  }

  // “Wunsch Behandlung” für Quick Look: aus row/visits_state/services ableiten
  const wishServiceTitle =
    safeStr(rowOrCheckout?._serviceTitles?.[0]) ||
    (todayServices.length ? todayServices.map((s) => s.title).filter(Boolean).slice(0, 2).join(" · ") : "");

  // Timer anchor
  const checkInAt = safeStr(rowOrCheckout?._checkInAt) || safeStr(visit?.createdAt);
  const activeSince = safeStr(rowOrCheckout?._activeSince);

  // Staff default in sheet
  const rowAssigned = safeStr(rowOrCheckout?.assignedStaffId) || safeStr(rowOrCheckout?._preferredStaffId);
  const staffValueDefault = safeStr(activeStaffId) || rowAssigned;

  setVisitSheet({
    open: true,
    mode: status === "done" ? "checkout" : status || modeHint || tab,
    rowId: String(rowOrCheckout?.id || ""),
    visitId,
    areaId: String(rowOrCheckout?.areaId || ""),
    title,
    sub,
    status,
    checkInAt,
    waitingSince: checkInAt,
    activeSince,
    areaName: safeStr(rowOrCheckout?._areaName) || "",
    wishServiceTitle,
    preferredStaffName: safeStr(rowOrCheckout?._preferredStaffName) || "",
    assignedStaffName: safeStr(rowOrCheckout?._assignedStaffName) || "",
    note: safeStr(visit?.note) || safeStr(rowOrCheckout?.note) || "",
    services: todayServices,
    products: todayProducts,
    members,
    profile: finalProfile,
    history,
    liveboard,
    staffValue: staffValueDefault,
  });
}


  // longest dropdown: waiting vs active
  const [longestMode, setLongestMode] = useState("active"); // active | waiting

  // tick for live timers (seconds)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2200);
  }

  // Escape closes overlays/modals
  useEffect(() => {
    const onKey = (e) => {
   if (e.key === "Escape") {
  setOverlay({ open: false, title: "", mode: "", items: [], tone: "waiting" });
  setStatusModal({ open: false, visitId: "" });
  setCustomerModal((m) => ({ ...m, open: false }));
  closeVisitSheet(); // ✅ neu
}

    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function loadBase() {
    const [a, st] = await Promise.all([db.areas.toArray().catch(() => []), db.staff.toArray().catch(() => [])]);

    const cleanAreas = (a || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .sort((x, y) => Number(x.displayNo || 9999) - Number(y.displayNo || 9999));

    const cleanStaff = (st || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));

    setAreas(cleanAreas);
    setStaff(cleanStaff);

    if (!activeStaffId && usb.staffId) setActiveStaffId(usb.staffId);
  }

  const autoAssignGuard = useRef(new Set()); // prevents repeating auto-assign in same session

  async function loadBoard() {
    const nowIso = new Date().toISOString();

    const [vas, visits, visitServices] = await Promise.all([
      db.visit_area_state.where("dateKey").equals(dateKey).toArray().catch(() => []),
      db.visits.where("dateKey").equals(dateKey).toArray().catch(() => []),
      db.visit_services.where("dateKey").equals(dateKey).toArray().catch(() => []),
    ]);

    const visitById = new Map((visits || []).map((v) => [String(v.id), v]));
    const areaById = new Map((areas || []).map((a) => [String(a.id), a]));
    const staffById = new Map((staff || []).map((s) => [String(s.id), s]));

    // Members per visit (we need primary member for participant line)
    const visitIds = Array.from(new Set((visits || []).map((v) => String(v.id)).filter(Boolean)));
    let members = [];
    try {
      if ((db?.tables || []).some((t) => t?.name === "visit_members") && visitIds.length) {
        members = await db.visit_members.where("visitId").anyOf(visitIds).toArray();
      }
    } catch {
      members = [];
    }

    const membersByVisit = new Map();
    const primaryByVisit = new Map();
    for (const m of members || []) {
      const vid = String(m.visitId || "");
      if (!vid) continue;

      if (!membersByVisit.has(vid)) membersByVisit.set(vid, []);
      const nm = safeStr(m.displayName) || safeStr(m.name) || safeStr(m.phone) || "";
      if (nm) membersByVisit.get(vid).push(nm);

      if (String(m.role || "") === "primary" && !primaryByVisit.has(vid)) primaryByVisit.set(vid, m);
    }
    for (const [vid, list] of membersByVisit.entries()) {
      const uniq = Array.from(new Set(list)).filter(Boolean);
      uniq.sort((a, b) => a.localeCompare(b));
      membersByVisit.set(vid, uniq);
    }

    // group services by (visitId+areaId)
    const svcMap = new Map();
    for (const s of visitServices || []) {
      const key = `${String(s.visitId)}__${String(s.areaId)}`;
      if (!svcMap.has(key)) svcMap.set(key, []);
      svcMap.get(key).push(s);
    }

    // readiness: all areas done for a visit
    const statesByVisit = new Map();
    for (const stRow of vas || []) {
      const vid = String(stRow.visitId || "");
      if (!vid) continue;
      if (!statesByVisit.has(vid)) statesByVisit.set(vid, []);
      statesByVisit.get(vid).push(stRow);
    }
    const readinessByVisit = new Map();
    for (const [vid, list] of statesByVisit.entries()) {
      const any = list.length > 0;
      const allDone = any && list.every((x) => String(x.status) === "done");
      readinessByVisit.set(vid, { any, allDone, pending: list.filter((x) => String(x.status) !== "done").length });
    }

    const patchOps = [];

    const enriched = (vas || []).map((x) => {
      const visit = visitById.get(String(x.visitId)) || null;
      const area = areaById.get(String(x.areaId)) || null;

      // base name
      const baseName =
        safeStr(visit?.displayName) ||
        safeStr(visit?.customerName) ||
        safeStr(x.displayName) ||
        `Visit ${String(x.visitId).slice(-6)}`;

      // Group top + participant bottom (but keep readable customer name as requested)
      const vid = String(x.visitId || "");
      const isGroup = String(visit?.type || "") === "group";
      const groupLabel = isGroup ? inferGroupLabel(visit) : "";
      const primaryMember = primaryByVisit.get(vid) || null;
      const participantLabel = isGroup ? inferParticipantLabel(visit, primaryMember) : "";

      // IMPORTANT: user wants "customer name stays as before but clickable"
      // So show baseName as the main line ALWAYS.
      // For groups, optionally show group label as subline if it differs.
      const displayName = baseName;
      const displaySub = isGroup && groupLabel && groupLabel !== baseName ? groupLabel : participantLabel ? participantLabel : "";

      const memberNames = membersByVisit.get(vid) || [];

      // waiting timer must start immediately: use visit.createdAt
      const checkInAt = inferCheckInAt(visit, x);

      const areaName = safeStr(area?.name) || safeStr(x.areaName) || "Bereich";

      const assigned = x.assignedStaffId ? staffById.get(String(x.assignedStaffId)) : null;
      const preferred = x.preferredStaffId ? staffById.get(String(x.preferredStaffId)) : null;

      const key = `${String(x.visitId)}__${String(x.areaId)}`;
      const services = svcMap.get(key) || [];
      const svcs = services.map((s) => safeStr(s.title)).filter(Boolean);

      const status = String(x.status || "");
      const activeSince = inferActiveStart({ status, row: x, visit, services });
      const checkoutAt = safeStr(x.endedAt);

      // durations
      const waitingMs =
        activeSince ? msBetween(checkInAt, activeSince) : status === "waiting" ? msBetween(checkInAt, nowIso) : 0;

      const activeMs =
        activeSince && status === "active"
          ? msBetween(activeSince, nowIso)
          : activeSince && status === "done"
            ? msBetween(activeSince, checkoutAt)
            : 0;

      const elapsedMs = status === "waiting" ? waitingMs : status === "active" ? activeMs : status === "done" ? activeMs : 0;

      const ready = readinessByVisit.get(String(x.visitId)) || { any: false, allDone: false, pending: 0 };

      const preferredStaffId = safeStr(x.preferredStaffId);
      const preferredStaffName = safeStr(x.preferredStaffName) || safeStr(preferred?.name) || "";

      const assignedStaffId = safeStr(x.assignedStaffId);
      const assignedStaffName = safeStr(x.assignedStaffName) || safeStr(assigned?.name) || "";

      // Persist auto-assign (once): assigned empty but preferred exists
      if (!assignedStaffId && preferredStaffId) {
        const guardKey = String(x.id);
        if (!autoAssignGuard.current.has(guardKey)) {
          autoAssignGuard.current.add(guardKey);
          patchOps.push(
            db.visit_area_state.update(x.id, {
              assignedStaffId: preferredStaffId,
              assignedStaffName: preferredStaffName,
            })
          );
        }
      }

      return {
        ...x,
        _status: status,

        // display
        _displayName: displayName,
        _displaySub: displaySub,
        _baseDisplayName: baseName,
        _groupLabel: groupLabel,
        _participantLabel: participantLabel,
        _memberNames: memberNames,

        // time
        _checkInAt: checkInAt,
        _activeSince: activeSince,
        _checkoutAt: checkoutAt,
        _waitingMs: waitingMs,
        _activeMs: activeMs,
        _elapsedMs: elapsedMs,

        // meta
        _areaName: areaName,
        _preferredStaffId: preferredStaffId,
        _preferredStaffName: preferredStaffName,
        _assignedStaffName: assignedStaffName,
        _serviceTitles: svcs,

        _visitReadyAllDone: !!ready.allDone,
        _visitPendingCount: Number(ready.pending || 0),
        _isGroup: isGroup,
      };
    });

    if (patchOps.length) Promise.allSettled(patchOps).catch(() => {});
    setRows(enriched);
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!areas.length) return;
    loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, areas.length, staff.length]);

  // live refresh (waiting/active) – recompute from ISO timestamps each tick
  const liveRows = useMemo(() => {
    void tick;
    const nowIso = new Date().toISOString();
    return rows.map((r) => {
      if (r._status !== "waiting" && r._status !== "active") return r;

      const checkInAt = safeStr(r._checkInAt);
      const activeSince = safeStr(r._activeSince);

      const waitingMs =
        activeSince ? msBetween(checkInAt, activeSince) : r._status === "waiting" ? msBetween(checkInAt, nowIso) : 0;

      const activeMs = activeSince && r._status === "active" ? msBetween(activeSince, nowIso) : Number(r._activeMs || 0);

      const elapsedMs = r._status === "waiting" ? waitingMs : r._status === "active" ? activeMs : 0;

      return { ...r, _waitingMs: waitingMs, _activeMs: activeMs, _elapsedMs: elapsedMs };
    });
  }, [rows, tick]);

  // filters
  const areaFilterActive = selectedAreaIds.size > 0;
  const nameFilterActive = selectedNames.size > 0;
  const preferredFilterActive = selectedPreferredStaff.size > 0;
  const searchQ = searchName.trim().toLowerCase();

  // Pending rows by visit (for centered status modal)
  const pendingByVisit = useMemo(() => {
    const m = new Map();
    for (const r of liveRows || []) {
      const vid = String(r.visitId || "");
      if (!vid) continue;
      if (String(r._status) === "done") continue;
      if (!m.has(vid)) m.set(vid, []);
      m.get(vid).push(r);
    }
    for (const [vid, list] of m.entries()) {
      list.sort((a, b) => {
        const ra = a._status === "active" ? 0 : 1;
        const rb = b._status === "active" ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return String(a._checkInAt || "").localeCompare(String(b._checkInAt || ""));
      });
      m.set(vid, list);
    }
    return m;
  }, [liveRows]);

  // Checkout tab groups by visit (DONE rows)
  const checkoutVisits = useMemo(() => {
    const done = (liveRows || []).filter((r) => String(r._status) === "done");
    const byVisit = new Map();
    for (const r of done) {
      const vid = String(r.visitId || "");
      if (!vid) continue;
      if (!byVisit.has(vid)) byVisit.set(vid, []);
      byVisit.get(vid).push(r);
    }

    const out = [];
    for (const [visitId, list] of byVisit.entries()) {
      const first = list[0];

      const displayName = first?._displayName || `Visit ${visitId.slice(-6)}`;
      const displaySub = safeStr(first?._displaySub);

      const checkInAt = first?._checkInAt || "";

      const activeSince =
        (list || [])
          .map((x) => safeStr(x._activeSince))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))[0] || "";

      const checkoutAt =
        (list || [])
          .map((x) => safeStr(x._checkoutAt))
          .filter(Boolean)
          .sort((a, b) => b.localeCompare(a))[0] || "";

      const waitingMs = activeSince ? msBetween(checkInAt, activeSince) : 0;
      const activeMs = activeSince && checkoutAt ? msBetween(activeSince, checkoutAt) : 0;

      const pending = Math.max(0, Number(first?._visitPendingCount || 0));
      const allDone = !!(first?._visitReadyAllDone) && pending === 0;

      const staffNames = (list || []).map((x) => safeStr(x._assignedStaffName)).filter(Boolean);
      const staffName = staffNames[0] || "—";

      out.push({
        visitId,
        displayName,
        displaySub,
        checkInAt,
        activeSince,
        checkoutAt,
        waitingMs,
        activeMs,
        staffName,
        allDone,
        pendingCount: pending,
      });
    }

    let list = out.filter((x) => (searchQ ? String(x.displayName || "").toLowerCase().includes(searchQ) : true));
    list.sort((a, b) => String(b.checkoutAt || "").localeCompare(String(a.checkoutAt || "")));
    return list;
  }, [liveRows, searchQ]);

  // candidates for filter checkboxes (use base name)
  const nameCandidates = useMemo(() => {
    const base = (liveRows || []).filter((r) => r._status !== "done");
    const uniq = Array.from(new Set(base.map((r) => safeStr(r._baseDisplayName)).filter(Boolean)));
    uniq.sort((a, b) => a.localeCompare(b));
    const q = nameFilterQ.trim().toLowerCase();
    return q ? uniq.filter((n) => n.toLowerCase().includes(q)) : uniq;
  }, [liveRows, nameFilterQ]);

  const preferredStaffCandidates = useMemo(() => {
    const base = (liveRows || []).filter((r) => r._status !== "done");
    const uniq = Array.from(new Set(base.map((r) => safeStr(r._preferredStaffName)).filter(Boolean)));
    uniq.sort((a, b) => a.localeCompare(b));
    const q = prefStaffFilterQ.trim().toLowerCase();
    return q ? uniq.filter((n) => n.toLowerCase().includes(q)) : uniq;
  }, [liveRows, prefStaffFilterQ]);

  // waiting/active filtered list
  const filteredRows = useMemo(() => {
    if (tab === "checkout") return [];

    const st = String(tab);
    let list = (liveRows || []).filter((r) => String(r._status) === st);

    if (areaFilterActive) list = list.filter((r) => selectedAreaIds.has(String(r.areaId)));
    if (nameFilterActive) list = list.filter((r) => selectedNames.has(String(r._baseDisplayName)));
    if (preferredFilterActive) list = list.filter((r) => selectedPreferredStaff.has(String(r._preferredStaffName || "")));
    if (searchQ) {
      list = list.filter((r) => {
        const a = String(r._displayName || "").toLowerCase();
        const b = String(r._displaySub || "").toLowerCase();
        return a.includes(searchQ) || b.includes(searchQ);
      });
    }

    const dirMul = sort.dir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return dirMul * cmp(String(a._displayName || "").toLowerCase(), String(b._displayName || "").toLowerCase());
        case "checkin":
          return dirMul * cmp(String(a._checkInAt || ""), String(b._checkInAt || ""));
        case "activeSince":
          return dirMul * cmp(String(a._activeSince || ""), String(b._activeSince || ""));
        case "area":
          return dirMul * cmp(String(a._areaName || "").toLowerCase(), String(b._areaName || "").toLowerCase());
        case "wish":
          return dirMul * cmp(
            String(a._serviceTitles?.[0] || "").toLowerCase(),
            String(b._serviceTitles?.[0] || "").toLowerCase()
          );
        case "prefStaff":
          return dirMul * cmp(String(a._preferredStaffName || "").toLowerCase(), String(b._preferredStaffName || "").toLowerCase());
        case "staff":
          return dirMul * cmp(String(a._assignedStaffName || "").toLowerCase(), String(b._assignedStaffName || "").toLowerCase());

        case "waitingMs":
          return dirMul * cmp(Number(a._waitingMs || 0), Number(b._waitingMs || 0));
        case "activeMs":
          return dirMul * cmp(Number(a._activeMs || 0), Number(b._activeMs || 0));

        case "timer":
        default:
          return dirMul * cmp(Number(a._elapsedMs || 0), Number(b._elapsedMs || 0));
      }
    });

    return list;
  }, [
    liveRows,
    tab,
    areaFilterActive,
    selectedAreaIds,
    nameFilterActive,
    selectedNames,
    preferredFilterActive,
    selectedPreferredStaff,
    searchQ,
    sort,
  ]);

  // KPI calculations (respect filters)
  const kpis = useMemo(() => {
    const base = (liveRows || [])
      .filter((r) => (!areaFilterActive ? true : selectedAreaIds.has(String(r.areaId))))
      .filter((r) => (!nameFilterActive ? true : selectedNames.has(String(r._baseDisplayName))))
      .filter((r) => (!preferredFilterActive ? true : selectedPreferredStaff.has(String(r._preferredStaffName || ""))));

    const waiting = base.filter((r) => r._status === "waiting").length;
    const active = base.filter((r) => r._status === "active").length;
    const done = base.filter((r) => r._status === "done").length;

    const maxWaiting = base.filter((r) => r._status === "waiting").reduce((m, r) => Math.max(m, Number(r._waitingMs || 0)), 0);
    const maxActive = base.filter((r) => r._status === "active").reduce((m, r) => Math.max(m, Number(r._activeMs || 0)), 0);

    return { waiting, active, done, maxWaiting, maxActive };
  }, [liveRows, areaFilterActive, selectedAreaIds, nameFilterActive, selectedNames, preferredFilterActive, selectedPreferredStaff]);

  function jumpToLongest(mode) {
    if (mode === "waiting") {
      const list = (liveRows || [])
        .filter((r) => r._status === "waiting")
        .sort((a, b) => Number(b._waitingMs || 0) - Number(a._waitingMs || 0));
      const top = list[0];
      if (top?._baseDisplayName) setSelectedNames(new Set([String(top._baseDisplayName)]));
      setTab("waiting");
      openOverlayForKpi("waiting");
      return;
    }
    const list = (liveRows || [])
      .filter((r) => r._status === "active")
      .sort((a, b) => Number(b._activeMs || 0) - Number(a._activeMs || 0));
    const top = list[0];
    if (top?._baseDisplayName) setSelectedNames(new Set([String(top._baseDisplayName)]));
    setTab("active");
    openOverlayForKpi("active");
  }

  function toggleSet(setter, value) {
    const key = String(value);
    setter((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function clearAreas() {
    setSelectedAreaIds(new Set());
  }
  function clearNames() {
    setSelectedNames(new Set());
  }
  function clearPreferredStaff() {
    setSelectedPreferredStaff(new Set());
  }
  function clearAllFilters() {
    clearAreas();
    clearNames();
    clearPreferredStaff();
    setNameFilterQ("");
    setPrefStaffFilterQ("");
  }

  async function setRowStaff(rowId, staffId) {
    const sid = safeStr(staffId);
    const s = staff.find((x) => String(x.id) === sid) || null;
    await db.visit_area_state.update(rowId, {
      assignedStaffId: sid || null,
      assignedStaffName: s ? String(s.name || "") : "",
    });
  }

  function ensureStaffOrToast(row) {
    const selected = safeStr(activeStaffId) || safeStr(row?.assignedStaffId) || safeStr(row?._preferredStaffId);
    if (selected) return selected;
    showToast("Bitte zuerst Mitarbeiter wählen.");
    return "";
  }

 async function take(row, staffIdOverride = "") {
  if (!row?.id) return;

  const override = safeStr(staffIdOverride);
  const finalStaffId = override || ensureStaffOrToast(row);
  if (!finalStaffId) return;

  setBusyId(row.id);
  try {
    const nowIso = new Date().toISOString();

    const s = staff.find((x) => String(x.id) === String(finalStaffId)) || null;
    const staffName = s ? String(s.name || "") : safeStr(row._assignedStaffName || row._preferredStaffName);

    // waiting timer: from check-in -> now
    const waitingStart = safeStr(row._checkInAt);
    if (waitingStart) {
      const ms = msBetween(waitingStart, nowIso);
      const visit = await db.visits.get(String(row.visitId)).catch(() => null);
      const customerId = visit?.customerId ? String(visit.customerId) : "";

      await logCustomerTimerToHistory({
        customerId,
        visitId: row.visitId,
        areaId: row.areaId,
        areaName: row._areaName,
        staffId: finalStaffId,
        staffName,
        type: "WAITING_TIMER",
        startedAt: waitingStart,
        endedAt: nowIso,
        durationMs: ms,
      });
    }

    await db.visit_area_state.update(row.id, {
      status: "active",
      assignedStaffId: finalStaffId || null,
      assignedStaffName: staffName || "",
      startedAt: nowIso,
      endedAt: null,
    });

    showToast("Übernommen. Aktiv-Timer läuft.");
    await loadBoard();
  } catch (e) {
    showToast(String(e?.message || e));
  } finally {
    setBusyId("");
  }
}


  async function finish(row) {
    if (!row?.id) return;
    setBusyId(row.id);
    try {
      const nowIso = new Date().toISOString();

      const activeStart = safeStr(row._activeSince) || safeStr(row.startedAt);
      if (activeStart) {
        const ms = msBetween(activeStart, nowIso);
        const visit = await db.visits.get(String(row.visitId)).catch(() => null);
        const customerId = visit?.customerId ? String(visit.customerId) : "";

        await logCustomerTimerToHistory({
          customerId,
          visitId: row.visitId,
          areaId: row.areaId,
          areaName: row._areaName,
          staffId: safeStr(row.assignedStaffId),
          staffName: safeStr(row._assignedStaffName),
          type: "ACTIVE_TIMER",
          startedAt: activeStart,
          endedAt: nowIso,
          durationMs: ms,
        });
      }

      await db.visit_area_state.update(row.id, {
        status: "done",
        endedAt: nowIso,
      });

      showToast("Fertig. Für Checkout gesammelt.");
      await loadBoard();
    } catch (e) {
      showToast(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  async function undoToWaiting(row) {
    if (!row?.id) return;
    const ok = window.confirm("Zurück auf Wartend setzen? (Aktiv-Timer wird verworfen)");
    if (!ok) return;

    setBusyId(row.id);
    try {
      await db.visit_area_state.update(row.id, {
        status: "waiting",
        startedAt: null,
        endedAt: null,
      });
      showToast("Zurück auf Wartend.");
      await loadBoard();
    } catch (e) {
      showToast(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  function closeOverlay() {
    setOverlay({ open: false, title: "", mode: "", items: [], tone: "waiting" });
  }

  function openOverlayForKpi(mode) {
    if (mode === "checkout") setOverlaySort({ key: "checkoutAt", dir: "desc" });
    else if (mode === "waiting") setOverlaySort({ key: "waitingMs", dir: "desc" });
    else if (mode === "active") setOverlaySort({ key: "activeMs", dir: "desc" });
    else setOverlaySort({ key: "timer", dir: "desc" });

    if (mode === "checkout") {
      setOverlay({ open: true, title: "Checkout – Details", mode: "checkout", items: checkoutVisits, tone: "checkout" });
      return;
    }

    if (mode === "waiting") {
      const list = (liveRows || [])
        .filter((r) => r._status === "waiting")
        .sort((a, b) => Number(b._waitingMs || 0) - Number(a._waitingMs || 0))
        .slice(0, 120);
      setOverlay({ open: true, title: "Warteliste – Details", mode: "waitingRows", items: list, tone: "waiting" });
      return;
    }

    if (mode === "active") {
      const list = (liveRows || [])
        .filter((r) => r._status === "active")
        .sort((a, b) => Number(b._activeMs || 0) - Number(a._activeMs || 0))
        .slice(0, 120);
      setOverlay({ open: true, title: "In Behandlung – Details", mode: "activeRows", items: list, tone: "active" });
      return;
    }
  }

  function sortHeader(label, key) {
    const on = sort.key === key;
    const arrow = on ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
    return (
      <button
        type="button"
        className={`${styles.sortHeadBtn} ${on ? styles.sortHeadBtnOn : ""}`}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? nextDir(s.dir) : "asc" }))}
        title={`Sortieren nach ${label}`}
      >
        <span>{label}</span>
        <span className={styles.sortArrow}>{arrow}</span>
      </button>
    );
  }

  function sortMini(label, key) {
    const on = overlaySort.key === key;
    const arrow = on ? (overlaySort.dir === "asc" ? "▲" : "▼") : "↕";
    return (
      <button
        type="button"
        className={`${styles.sortHeadBtn} ${on ? styles.sortHeadBtnOn : ""}`}
        onClick={() => setOverlaySort((s) => ({ key, dir: s.key === key ? nextDir(s.dir) : "asc" }))}
        title={`Sortieren nach ${label}`}
      >
        <span>{label}</span>
        <span className={styles.sortArrow}>{arrow}</span>
      </button>
    );
  }

  const overlayItemsSorted = useMemo(() => {
    if (!overlay.open) return [];
    const dirMul = overlaySort.dir === "asc" ? 1 : -1;
    const items = overlay.items || [];

    const sorted = [...items].sort((a, b) => {
      if (overlay.mode === "checkout") {
        switch (overlaySort.key) {
          case "name":
            return dirMul * cmp(String(a.displayName || "").toLowerCase(), String(b.displayName || "").toLowerCase());
          case "checkin":
            return dirMul * cmp(String(a.checkInAt || ""), String(b.checkInAt || ""));
          case "activeSince":
            return dirMul * cmp(String(a.activeSince || ""), String(b.activeSince || ""));
          case "checkoutAt":
            return dirMul * cmp(String(a.checkoutAt || ""), String(b.checkoutAt || ""));
          case "waitingMs":
            return dirMul * cmp(Number(a.waitingMs || 0), Number(b.waitingMs || 0));
          case "activeMs":
            return dirMul * cmp(Number(a.activeMs || 0), Number(b.activeMs || 0));
          default:
            return dirMul * cmp(String(a.checkoutAt || ""), String(b.checkoutAt || ""));
        }
      }

      switch (overlaySort.key) {
        case "name":
          return dirMul * cmp(String(a._displayName || "").toLowerCase(), String(b._displayName || "").toLowerCase());
        case "checkin":
          return dirMul * cmp(String(a._checkInAt || ""), String(b._checkInAt || ""));
        case "activeSince":
          return dirMul * cmp(String(a._activeSince || ""), String(b._activeSince || ""));
        case "area":
          return dirMul * cmp(String(a._areaName || "").toLowerCase(), String(b._areaName || "").toLowerCase());
        case "wish":
          return dirMul * cmp(
            String(a._serviceTitles?.[0] || "").toLowerCase(),
            String(b._serviceTitles?.[0] || "").toLowerCase()
          );
        case "prefStaff":
          return dirMul * cmp(String(a._preferredStaffName || "").toLowerCase(), String(b._preferredStaffName || "").toLowerCase());
        case "staff":
          return dirMul * cmp(String(a._assignedStaffName || "").toLowerCase(), String(b._assignedStaffName || "").toLowerCase());
        case "waitingMs":
          return dirMul * cmp(Number(a._waitingMs || 0), Number(b._waitingMs || 0));
        case "activeMs":
          return dirMul * cmp(Number(a._activeMs || 0), Number(b._activeMs || 0));
        case "timer":
        default:
          return dirMul * cmp(Number(a._elapsedMs || 0), Number(b._elapsedMs || 0));
      }
    });

    return sorted;
  }, [overlay.open, overlay.items, overlay.mode, overlaySort]);

  // Tabs
  const smartTabs = [
    { key: "waiting", title: "Warteliste", kpi: kpis.waiting, tone: "waiting" },
    { key: "active", title: "In Behandlung", kpi: kpis.active, tone: "active" },
    { key: "checkout", title: "Checkout", kpi: checkoutVisits.length || 0, tone: "checkout" },
  ];

  const longestKpiValue = longestMode === "waiting" ? kpis.maxWaiting : kpis.maxActive;
  const longestKpiLabel = longestMode === "waiting" ? "Längste Wartezeit" : "Längste Aktivzeit";

  const statusModalItems = useMemo(() => {
    if (!statusModal.open || !statusModal.visitId) return [];
    const list = pendingByVisit.get(String(statusModal.visitId)) || [];
    return list.map((r) => {
      const services = r._serviceTitles || [];
      const wish = services.length ? services.slice(0, 3).join(" · ") : "—";
      const wait = fmtDuration(Number(r._waitingMs || 0));
      const act =
        r._status === "active"
          ? fmtDuration(Number(r._activeMs || 0))
          : r._status === "done"
            ? fmtDuration(Number(r._activeMs || 0))
            : "—";

      return {
        id: String(r.id),
        area: r._areaName || "—",
        state: statusLabel(r._status),
        staff: safeStr(r._assignedStaffName) || safeStr(r._preferredStaffName) || "—",
        wait,
        act,
        wish,
      };
    });
  }, [statusModal.open, statusModal.visitId, pendingByVisit]);

  function openStatusModal(visitId) {
    setStatusModal({ open: true, visitId: String(visitId || "") });
  }

  /* =========================
     Customer Modal (Profile/History/Today)
========================= */
  async function openCustomerModalFromRow(rowOrCheckout) {
    const visitId = String(rowOrCheckout?.visitId || "");
    if (!visitId) return;

    const visit = await db.visits.get(visitId).catch(() => null);
    const customerId = visit?.customerId ? String(visit.customerId) : "";

    // Title: keep readable customer name (as requested)
    const baseTitle =
      safeStr(visit?.displayName) ||
      safeStr(rowOrCheckout?.displayName) ||
      safeStr(rowOrCheckout?._displayName) ||
      `Visit ${visitId.slice(-6)}`;

    // Group: show info in subtitle (not replacing main title)
    const isGroup = String(visit?.type || "") === "group";
    const groupLabel = isGroup ? safeStr(visit?.displayName) : "";
    const participantLabel = "";

    // Profile
    let profile = null;
    try {
      if (customerId && (db?.tables || []).some((t) => t?.name === "customers")) {
        profile = await db.customers.get(customerId).catch(() => null);
      }
    } catch {
      profile = null;
    }

    const fallbackProfile = {
      id: customerId || "",
      displayName: baseTitle,
      phone: "",
      instagram: "",
      email: "",
      visitCount: 0,
    };
    const finalProfile = profile ? { ...fallbackProfile, ...profile } : fallbackProfile;

    // Members
    let members = [];
    try {
      if ((db?.tables || []).some((t) => t?.name === "visit_members")) {
        const mm = await db.visit_members.where("visitId").equals(visitId).toArray().catch(() => []);
        members = (mm || [])
          .map((x) => safeStr(x.displayName) || safeStr(x.name) || safeStr(x.phone))
          .filter(Boolean);
      }
    } catch {
      members = [];
    }

    // Liveboard snapshot for this visit (today)
    const liveboard = (liveRows || [])
      .filter((r) => String(r.visitId || "") === visitId)
      .map((r) => ({
        id: String(r.id),
        areaId: String(r.areaId || ""),
        areaName: safeStr(r._areaName),
        status: safeStr(r._status),
        waitingMs: Number(r._waitingMs || 0),
        activeMs: Number(r._activeMs || 0),
        note: safeStr(r.note),
        staff: safeStr(r._assignedStaffName) || safeStr(r._preferredStaffName) || "",
      }))
      .sort((a, b) => String(a.areaName).localeCompare(String(b.areaName)));

    // HISTORY: older visits for this customerId (exclude current visitId, exclude today if you want)
    let history = [];
    try {
      if (customerId) {
        const all = await db.visits.where("customerId").equals(customerId).toArray().catch(() => []);
        history = (all || [])
          .filter((v) => String(v.id || "") !== visitId)
          .map((v) => ({
            visitId: String(v.id || ""),
            dateKey: safeStr(v.dateKey),
            createdAt: safeStr(v.createdAt),
            total: Number(v.total || v.sum || v.amount || 0) || 0,
            note: safeStr(v.note || v.comment || ""),
            type: safeStr(v.type || ""),
            status: safeStr(v.status || ""),
          }))
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
          .slice(0, 80);
      }
    } catch {
      history = [];
    }

    // TODAY: services & products from THIS visit (with wish staff + notes)
    let todayServices = [];
    let todayProducts = [];
    let notesByArea = [];
    let preferredByArea = [];
    try {
      const [vs, vp, vas] = await Promise.all([
        db.visit_services.where("visitId").equals(visitId).toArray().catch(() => []),
        db.visit_products.where("visitId").equals(visitId).toArray().catch(() => []),
        db.visit_area_state.where("visitId").equals(visitId).toArray().catch(() => []),
      ]);

      todayServices = (vs || []).map((s) => ({
        id: String(s.id),
        title: safeStr(s.title),
        areaId: String(s.areaId || ""),
        areaName: safeStr(areas.find((a) => String(a.id) === String(s.areaId))?.name) || "",
        price: Number(s.price || 0) || 0,
        note: safeStr(s.note),
        memberId: safeStr(s.memberId),
      }));

      todayProducts = (vp || []).map((p) => ({
        id: String(p.id),
        title: safeStr(p.title),
        qty: Number(p.qty || 1) || 1,
        price: Number(p.price || 0) || 0,
        memberId: safeStr(p.memberId),
      }));

      notesByArea = (vas || [])
        .map((r) => ({
          areaId: String(r.areaId || ""),
          areaName: safeStr(areas.find((a) => String(a.id) === String(r.areaId))?.name) || safeStr(r.areaName) || "Bereich",
          note: safeStr(r.note),
        }))
        .filter((x) => !!x.note);

      preferredByArea = (vas || [])
        .map((r) => ({
          areaId: String(r.areaId || ""),
          areaName: safeStr(areas.find((a) => String(a.id) === String(r.areaId))?.name) || safeStr(r.areaName) || "Bereich",
          preferred: safeStr(r.preferredStaffName) || "—",
        }))
        .filter((x) => x.areaId);
    } catch {
      todayServices = [];
      todayProducts = [];
      notesByArea = [];
      preferredByArea = [];
    }

    setCustomerModal({
      open: true,
      visitId,
      customerId,
      title: baseTitle,
      groupLabel,
      participantLabel,
      tab: "profile",
      profile: finalProfile,
      history,
      today: { services: todayServices, products: todayProducts, notesByArea, preferredByArea },
      liveboard,
      members,
    });
  }

  function closeCustomerModal() {
    setCustomerModal((m) => ({ ...m, open: false }));
  }

  /* =========================
     Render helpers
========================= */

  function renderNameCell(row) {
    // Name stays exactly as before, just clickable
    return (
      <button type="button" className={styles.nameCellBtn} onClick={() => openCustomerModalFromRow(row)} title="Profil öffnen">
        <div className={styles.nameCell}>
          <div className={styles.bold}>{row._displayName}</div>
          {row._displaySub ? <div className={styles.smallMuted}>{row._displaySub}</div> : null}
        </div>
      </button>
    );
  }

  // Keep your area rendering, but do not change structure (CSS later)
  function renderAreaCell(areaName) {
    const raw = safeStr(areaName);
    if (!raw) return <div className={styles.plainText}>—</div>;
    const parts = raw.split("-").map((x) => safeStr(x)).filter(Boolean);
    if (parts.length >= 2) {
      return (
        <div className={styles.areaFull}>
          <div className={styles.areaLine1}>{parts[0]}</div>
          <div className={styles.areaLine2}>{parts.slice(1).join(" - ")}</div>
        </div>
      );
    }
    return <div className={styles.areaFull}>{raw}</div>;
  }

  function closeOverlayAndStatus() {
    setOverlay({ open: false, title: "", mode: "", items: [], tone: "waiting" });
    setStatusModal({ open: false, visitId: "" });
  }

  const filterPanelRef = useRef(null);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.h1}>Liveboard</h1>
            <div className={styles.sub}>
              Wartend → Aktiv → Checkout. Timer laufen live (Sekundenbereich), inkl. Gruppen-Logik.
            </div>
          </div>

          <div className={styles.controls}>
            <label className={styles.fLabel}>
              Datum
              <input className={styles.input} type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
            </label>

            <label className={styles.fLabel}>
              Aktiver Mitarbeiter
              <select className={styles.input} value={activeStaffId} onChange={(e) => setActiveStaffId(e.target.value)}>
                <option value="">(USB / nicht gewählt)</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <button className={styles.btnGhost} type="button" onClick={() => nav("/reception")}>
              Zurück
            </button>
          </div>
        </div>

        {toast ? <div className={styles.alertOk}>{toast}</div> : null}

        {/* KPI Row */}
        <div className={styles.kpis}>
          <button className={`${styles.kpi} ${styles.kpiWaiting}`} type="button" onClick={() => openOverlayForKpi("waiting")}>
            <div className={styles.kpiLabel}>Wartend</div>
            <div className={styles.kpiVal}>{kpis.waiting}</div>
            <div className={styles.kpiMeta}>Queue</div>
          </button>

          <button className={`${styles.kpi} ${styles.kpiActive}`} type="button" onClick={() => openOverlayForKpi("active")}>
            <div className={styles.kpiLabel}>Aktiv</div>
            <div className={styles.kpiVal}>{kpis.active}</div>
            <div className={styles.kpiMeta}>In Behandlung</div>
          </button>

          <button className={`${styles.kpi} ${styles.kpiCheckout}`} type="button" onClick={() => openOverlayForKpi("checkout")}>
            <div className={styles.kpiLabel}>Checkout</div>
            <div className={styles.kpiVal}>{checkoutVisits.length || 0}</div>
            <div className={styles.kpiMeta}>Kasse</div>
          </button>

          <button
            className={`${styles.kpi} ${styles.kpiLongest}`}
            type="button"
            onClick={() => jumpToLongest(longestMode)}
            title="Klick: Filter automatisch setzen & Details öffnen"
          >
            <div className={styles.kpiHeadRow}>
              <div className={styles.kpiLabel}>{longestKpiLabel}</div>
              <select
                className={styles.kpiSelect}
                value={longestMode}
                onChange={(e) => setLongestMode(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                title="Umschalten"
              >
                <option value="active">Aktiv</option>
                <option value="waiting">Wartend</option>
              </select>
            </div>
            <div className={styles.kpiVal}>{fmtDuration(longestKpiValue)}</div>
            <div className={styles.kpiMeta}>Auto-Filter</div>
          </button>
        </div>

        {/* Layout */}
        <div className={styles.boardLayout}>
          {/* Filters */}
          <div className={styles.filterCard} ref={filterPanelRef}>
            <div className={styles.cardHeadRow}>
              <div className={styles.cardTitle}>Filter</div>
              <button className={styles.btnGhostSm} type="button" onClick={clearAllFilters} title="Alle Filter zurücksetzen">
                Reset
              </button>
            </div>

            <div className={styles.sectionHeadRow}>
              <div className={styles.sectionTitle}>Bereiche</div>
              <button className={styles.btnGhostSm} type="button" onClick={clearAreas}>
                Alle
              </button>
            </div>

            <div className={styles.areaGridCompact}>
              {areas.map((a) => {
                const id = String(a.id);
                const checked = selectedAreaIds.has(id);
                return (
                  <label key={id} className={`${styles.areaPill} ${checked ? styles.areaPillOn : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSet(setSelectedAreaIds, id)} />
                    <span className={styles.areaName}>{a.name}</span>
                  </label>
                );
              })}
            </div>

            <div className={styles.sep} />

            <div className={styles.sectionHeadRow}>
              <div className={styles.sectionTitle}>Kunden</div>
              <button className={styles.btnGhostSm} type="button" onClick={clearNames}>
                Alle
              </button>
            </div>

            <input className={styles.searchSm} value={nameFilterQ} onChange={(e) => setNameFilterQ(e.target.value)} placeholder="Name filtern…" />

            <div className={styles.checkList}>
              {nameCandidates.length === 0 ? (
                <div className={styles.smallMuted}>Keine Kandidaten.</div>
              ) : (
                nameCandidates.slice(0, 14).map((n) => {
                  const checked = selectedNames.has(n);
                  return (
                    <label key={n} className={`${styles.checkItem} ${checked ? styles.checkItemOn : ""}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSet(setSelectedNames, n)} />
                      <span className={styles.checkText}>{n}</span>
                    </label>
                  );
                })
              )}
              {nameCandidates.length > 14 ? <div className={styles.smallMuted}>+{nameCandidates.length - 14} weitere</div> : null}
            </div>

            <div className={styles.sep} />

            <div className={styles.sectionHeadRow}>
              <div className={styles.sectionTitle}>Wunsch MA</div>
              <button className={styles.btnGhostSm} type="button" onClick={clearPreferredStaff}>
                Alle
              </button>
            </div>

            <input className={styles.searchSm} value={prefStaffFilterQ} onChange={(e) => setPrefStaffFilterQ(e.target.value)} placeholder="Wunsch filtern…" />

            <div className={styles.checkList}>
              {preferredStaffCandidates.length === 0 ? (
                <div className={styles.smallMuted}>Keine Kandidaten.</div>
              ) : (
                preferredStaffCandidates.slice(0, 14).map((n) => {
                  const checked = selectedPreferredStaff.has(n);
                  return (
                    <label key={n} className={`${styles.checkItem} ${checked ? styles.checkItemOn : ""}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSet(setSelectedPreferredStaff, n)} />
                      <span className={styles.checkText}>{n}</span>
                    </label>
                  );
                })
              )}
              {preferredStaffCandidates.length > 14 ? <div className={styles.smallMuted}>+{preferredStaffCandidates.length - 14} weitere</div> : null}
            </div>

            <div className={styles.note}>
              Hinweis: Timer laufen live. <b>Warten</b> = Zeit seit Check-in. <b>Aktiv</b> = Zeit seit “Übernehmen”.
            </div>
          </div>

          {/* Board */}
          <div className={styles.boardCard}>
            <div className={styles.boardTop}>
              {/* Tabs */}
              <div className={styles.browserTabs} role="tablist" aria-label="Liveboard Tabs">
                {smartTabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    className={`${styles.browserTab} ${tab === t.key ? styles.browserTabOn : ""} ${styles[`tone_${t.tone}`]}`}
                    onClick={() => setTab(t.key)}
                  >
                    <span className={styles.browserTabTitle}>{t.title}</span>
                    <span className={styles.browserTabKpi}>{t.kpi}</span>
                  </button>
                ))}
              </div>

              {/* Actions */}
              <div className={styles.boardActionsRight}>
                <input className={styles.search} value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Kunde / Gruppe suchen…" />
                <button className={styles.btnGhostSm} type="button" onClick={loadBoard}>
                  Aktualisieren
                </button>
              </div>
            </div>

            {/* Table */}
          <div className={`${styles.table} ${styles[`tableTone_${tab}`]}`}>
  <div className={styles.trHeadMini}>
    <div>{sortHeader("Kunde", "name")}</div>
    <div className={styles.taRight}>Aktion</div>
  </div>

  <div className={styles.scrollBody}>
    {tab === "checkout" ? (
      checkoutVisits.length === 0 ? (
        <div className={styles.empty}>Keine Checkout-Kandidaten gefunden.</div>
      ) : (
        checkoutVisits.map((v) => (
          <div key={v.visitId} className={`${styles.trRowMini} ${styles.rowToneCheckout}`}>
            <button
              type="button"
              className={styles.miniNameBtn}
              onClick={() => openVisitSheetFromRow(v, "checkout")}
              title="Kundenkarte öffnen"
            >
              <div className={styles.miniNameTop}>
                <span className={styles.bold}>{v.displayName}</span>
                {v.displaySub ? <span className={styles.miniTag}>{v.displaySub}</span> : null}
              </div>
              <div className={styles.miniMeta}>
                <span className={styles.pill}>Check-in {fmtClock(v.checkInAt)}</span>
                <span className={styles.pill}>Checkout {fmtClock(v.checkoutAt)}</span>
                {!v.allDone ? <span className={styles.warnBadge}>Offen ({v.pendingCount})</span> : <span className={styles.okBadge}>Bereit</span>}
              </div>
            </button>

            <div className={`${styles.taRight} ${styles.actionCell}`}>
              <button
                className={styles.btnPrimarySm}
                type="button"
                onClick={() => openVisitSheetFromRow(v, "checkout")}
                title="Details & zur Kasse"
              >
                Zur Kasse
              </button>
            </div>
          </div>
        ))
      )
    ) : filteredRows.length === 0 ? (
      <div className={styles.empty}>Keine Einträge. Prüfe Filter oder Suche.</div>
    ) : (
      filteredRows.map((r) => {
        const isBusy = String(busyId) === String(r.id);
        const rowTone = r._status === "waiting" ? styles.rowToneWaiting : styles.rowToneActive;

        return (
          <div key={r.id} className={`${styles.trRowMini} ${rowTone}`}>
            <button
              type="button"
              className={styles.miniNameBtn}
              onClick={() => openVisitSheetFromRow(r, tab)}
              title="Kundenkarte öffnen"
            >
              <div className={styles.miniNameTop}>
                <span className={styles.bold}>{r._displayName}</span>
                {r._displaySub ? <span className={styles.miniTag}>{r._displaySub}</span> : null}
              </div>

              <div className={styles.miniMeta}>
                <span className={styles.pill}>Check-in {fmtClock(r._checkInAt)}</span>
                {tab === "waiting" ? (
                  <span className={styles.pill}>Warten {fmtDuration(r._waitingMs)}</span>
                ) : (
                  <span className={styles.pill}>Aktiv {fmtDuration(r._activeMs)}</span>
                )}
              </div>
            </button>

            <div className={`${styles.taRight} ${styles.actionCell}`}>
              {tab === "waiting" ? (
                <button
                  className={styles.btnPrimarySm}
                  type="button"
                  onClick={() => openVisitSheetFromRow(r, "waiting")}
                  disabled={isBusy}
                  title="Übernehmen (Mitarbeiter im Modal wählen)"
                >
                  {isBusy ? "…" : "Übernehmen"}
                </button>
              ) : (
                <>
                  <button
                    className={styles.btnPrimarySm}
                    type="button"
                    onClick={() => openVisitSheetFromRow(r, "active")}
                    disabled={isBusy}
                    title="Fertig / Zurück im Modal"
                  >
                    {isBusy ? "…" : "Fertig"}
                  </button>
                  <button className={styles.btnGhostSm} type="button" onClick={() => openVisitSheetFromRow(r, "active")} disabled={isBusy}>
                    Details
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })
    )}
  </div>
</div>


            <div className={styles.note}>
              Logik: <b>Warten</b> ab Check-in (visit.createdAt). <b>Aktiv</b> ab “Übernehmen” (startedAt). Sekunden sind immer sichtbar.
              Klick auf den Namen öffnet Profil/History/Heute.
            </div>
          </div>
        </div>
      </div>

      {/* Centered Status Modal (Checkout: Offen -> Details) */}
      {statusModal.open ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onMouseDown={() => setStatusModal({ open: false, visitId: "" })}>
          <div className={styles.modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div className={styles.modalTitle}>Offen – Details</div>
              <button className={styles.modalX} type="button" onClick={() => setStatusModal({ open: false, visitId: "" })} aria-label="Schließen">
                ×
              </button>
            </div>

            {statusModalItems.length === 0 ? (
              <div className={styles.modalEmpty}>Keine offenen Einträge gefunden.</div>
            ) : (
              <div className={styles.modalTable}>
                <div className={styles.modalTh}>
                  <div>Bereich</div>
                  <div>Status</div>
                  <div>MA</div>
                  <div className={styles.taRight}>Warten</div>
                  <div className={styles.taRight}>Aktiv</div>
                  <div>Wunsch</div>
                </div>
                {statusModalItems.slice(0, 60).map((x) => (
                  <div key={x.id} className={styles.modalTr}>
                    <div className={styles.bold}>{x.area}</div>
                    <div>{x.state}</div>
                    <div>{x.staff}</div>
                    <div className={`${styles.taRight} ${styles.mono}`}>{x.wait}</div>
                    <div className={`${styles.taRight} ${styles.mono}`}>{x.act}</div>
                    <div className={styles.miniWrap}>{x.wish}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* KPI Overlay */}
      {overlay.open ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={closeOverlayAndStatus}>
          <div className={`${styles.overlayCard} ${styles[`overlayTone_${overlay.tone}`]}`} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.overlayHead}>
              <div className={styles.overlayTitle}>{overlay.title}</div>
              <button className={styles.btnGhostSm} type="button" onClick={closeOverlayAndStatus}>
                Schließen
              </button>
            </div>

            <div className={styles.overlayBody}>
              {overlay.mode === "checkout" ? (
                overlayItemsSorted.length === 0 ? (
                  <div className={styles.empty}>Keine Einträge.</div>
                ) : (
                  <div className={styles.miniTable}>
                    <div className={styles.miniHeadCheckout}>
                      <div>{sortMini("Kunde", "name")}</div>
                      <div>{sortMini("Check-in", "checkin")}</div>
                      <div>{sortMini("Aktiv seit", "activeSince")}</div>
                      <div>{sortMini("Checkout", "checkoutAt")}</div>
                      <div className={styles.taRight}>{sortMini("Warten", "waitingMs")}</div>
                      <div className={styles.taRight}>{sortMini("Aktiv", "activeMs")}</div>
                      <div>Mitarbeiter</div>
                      <div>Status</div>
                    </div>

                    {overlayItemsSorted.map((v) => (
                      <div key={v.visitId} className={styles.miniRowCheckout}>
                        <div className={styles.bold}>{v.displayName}</div>
                        <div className={styles.mono}>{fmtClock(v.checkInAt)}</div>
                        <div className={styles.mono}>{fmtClock(v.activeSince)}</div>
                        <div className={styles.mono}>{fmtClock(v.checkoutAt)}</div>
                        <div className={`${styles.taRight} ${styles.mono}`}>{fmtDuration(v.waitingMs)}</div>
                        <div className={`${styles.taRight} ${styles.mono}`}>{fmtDuration(v.activeMs)}</div>
                        <div>{v.staffName || "—"}</div>
                        <div>{v.allDone ? <span className={styles.okBadge}>Bereit</span> : <span className={styles.warnBadge}>Offen</span>}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : overlayItemsSorted.length === 0 ? (
                <div className={styles.empty}>Keine Einträge.</div>
              ) : overlay.mode === "waitingRows" ? (
                <div className={styles.miniTable}>
                  <div className={styles.miniHeadWaiting}>
                    <div>{sortMini("Kunde", "name")}</div>
                    <div>{sortMini("Check-in", "checkin")}</div>
                    <div>{sortMini("Bereich", "area")}</div>
                    <div>{sortMini("Wunsch", "wish")}</div>
                    <div>{sortMini("Wunsch MA", "prefStaff")}</div>
                    <div>{sortMini("MA", "staff")}</div>
                    <div className={styles.taRight}>{sortMini("Warten", "waitingMs")}</div>
                  </div>

                  {overlayItemsSorted.map((r) => (
                    <div key={r.id} className={styles.miniRowWaiting}>
                      <div className={styles.bold}>{r._displayName}</div>
                      <div className={styles.mono}>{fmtClock(r._checkInAt)}</div>
                      <div>{r._areaName}</div>
                      <div className={styles.miniWrap}>{(r._serviceTitles || []).slice(0, 2).join(" · ") || "—"}</div>
                      <div>{r._preferredStaffName || "—"}</div>
                      <div>{r._assignedStaffName || "—"}</div>
                      <div className={`${styles.taRight} ${styles.mono}`}>{fmtDuration(Number(r._waitingMs || 0))}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.miniTable}>
                  <div className={styles.miniHeadActive}>
                    <div>{sortMini("Kunde", "name")}</div>
                    <div>{sortMini("Check-in", "checkin")}</div>
                    <div>{sortMini("Aktiv seit", "activeSince")}</div>
                    <div>{sortMini("Bereich", "area")}</div>
                    <div>{sortMini("Wunsch", "wish")}</div>
                    <div>{sortMini("Wunsch MA", "prefStaff")}</div>
                    <div>{sortMini("MA", "staff")}</div>
                    <div className={styles.taRight}>{sortMini("Aktiv", "activeMs")}</div>
                  </div>

                  {overlayItemsSorted.map((r) => (
                    <div key={r.id} className={styles.miniRowActive}>
                      <div className={styles.bold}>{r._displayName}</div>
                      <div className={styles.mono}>{fmtClock(r._checkInAt)}</div>
                      <div className={styles.mono}>{fmtClock(r._activeSince)}</div>
                      <div>{r._areaName}</div>
                      <div className={styles.miniWrap}>{(r._serviceTitles || []).slice(0, 2).join(" · ") || "—"}</div>
                      <div>{r._preferredStaffName || "—"}</div>
                      <div>{r._assignedStaffName || "—"}</div>
                      <div className={`${styles.taRight} ${styles.mono}`}>{fmtDuration(Number(r._activeMs || 0))}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.overlayFoot}>
              <div className={styles.smallMuted}>Klick auf Kundennamen öffnet Profil. Timer sind sekundengenau.</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Customer Modal */}
      {customerModal.open ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onMouseDown={closeCustomerModal}>
          <div className={styles.modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div className={styles.modalTitle}>
                {customerModal.title}
                {customerModal.groupLabel ? <span className={styles.smallMuted}> · {customerModal.groupLabel}</span> : null}
              </div>
              <button className={styles.modalX} type="button" onClick={closeCustomerModal} aria-label="Schließen">
                ×
              </button>
            </div>

            <div className={styles.modalTable}>
              {/* internal tabs:
                  - Bestellungen -> renamed to History (alte Besuche)
                  - NEW: Heute (Services/Produkte/Notizen/Wunsch-MA vom heutigen Visit)
              */}
              <div className={styles.browserTabs} role="tablist" aria-label="Customer Modal Tabs">
                <button
                  type="button"
                  className={`${styles.browserTab} ${customerModal.tab === "profile" ? styles.browserTabOn : ""}`}
                  onClick={() => setCustomerModal((m) => ({ ...m, tab: "profile" }))}
                >
                  Profil
                </button>

                <button
                  type="button"
                  className={`${styles.browserTab} ${customerModal.tab === "history" ? styles.browserTabOn : ""}`}
                  onClick={() => setCustomerModal((m) => ({ ...m, tab: "history" }))}
                >
                  History
                </button>

                <button
                  type="button"
                  className={`${styles.browserTab} ${customerModal.tab === "today" ? styles.browserTabOn : ""}`}
                  onClick={() => setCustomerModal((m) => ({ ...m, tab: "today" }))}
                >
                  Heute
                </button>
              </div>

              {/* PROFILE */}
              {customerModal.tab === "profile" ? (
                <div style={{ marginTop: 12 }}>
                  <div className={styles.modalTh}>
                    <div>Feld</div>
                    <div>Wert</div>
                    <div></div>
                    <div></div>
                  </div>

                  <div className={styles.modalTr}>
                    <div className={styles.bold}>Name</div>
                    <div className={styles.miniWrap}>{safeStr(customerModal.profile?.displayName) || customerModal.title || "—"}</div>
                    <div></div>
                    <div></div>
                  </div>

                  <div className={styles.modalTr}>
                    <div className={styles.bold}>Telefon</div>
                    <div className={styles.miniWrap}>{safeStr(customerModal.profile?.phone) || "—"}</div>
                    <div></div>
                    <div></div>
                  </div>

                  <div className={styles.modalTr}>
                    <div className={styles.bold}>Instagram</div>
                    <div className={styles.miniWrap}>{safeStr(customerModal.profile?.instagram) || "—"}</div>
                    <div></div>
                    <div></div>
                  </div>

                  <div className={styles.modalTr}>
                    <div className={styles.bold}>E-Mail</div>
                    <div className={styles.miniWrap}>{safeStr(customerModal.profile?.email) || "—"}</div>
                    <div></div>
                    <div></div>
                  </div>

                  {customerModal.groupLabel ? (
                    <>
                      <div style={{ height: 10 }} />
                      <div className={styles.modalTh}>
                        <div>Gruppe</div>
                        <div>Mitglieder</div>
                        <div></div>
                        <div></div>
                      </div>
                      <div className={styles.modalTr}>
                        <div className={styles.bold}>{customerModal.groupLabel}</div>
                        <div className={styles.miniWrap}>
                          {(customerModal.members || []).length ? (customerModal.members || []).join(" · ") : "—"}
                        </div>
                        <div></div>
                        <div></div>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {/* HISTORY (alte Besuche) */}
              {customerModal.tab === "history" ? (
                <div style={{ marginTop: 12 }}>
                  {(customerModal.history || []).length === 0 ? (
                    <div className={styles.modalEmpty}>Keine History gefunden.</div>
                  ) : (
                    <>
                      <div className={styles.modalTh}>
                        <div>Datum/Start</div>
                        <div>Status</div>
                        <div>Typ</div>
                        <div>Notiz</div>
                      </div>

                      {(customerModal.history || []).map((h) => (
                        <div key={h.visitId} className={styles.modalTr}>
                          <div>
                            <div className={styles.bold}>{h.dateKey || "—"}</div>
                            <div className={styles.smallMuted}>{fmtClock(h.createdAt)}</div>
                          </div>
                          <div>{h.status || "—"}</div>
                          <div>{h.type || "—"}</div>
                          <div className={styles.miniWrap}>{h.note || "—"}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ) : null}

              {/* TODAY (heute bestellte services + produkte + wish staff + notes) */}
              {customerModal.tab === "today" ? (
                <div style={{ marginTop: 12 }}>
                  <div className={styles.modalTh}>
                    <div>Services</div>
                    <div>Produkte</div>
                    <div>Wunsch MA</div>
                    <div>Notizen</div>
                  </div>

                  <div className={styles.modalTr}>
                    <div className={styles.miniWrap}>
                      {(customerModal.today?.services || []).length
                        ? (customerModal.today.services || [])
                            .map((s) => `${s.areaName ? `${s.areaName}: ` : ""}${s.title}${s.note ? ` (Notiz: ${s.note})` : ""}`)
                            .slice(0, 18)
                            .join(" · ")
                        : "—"}
                    </div>

                    <div className={styles.miniWrap}>
                      {(customerModal.today?.products || []).length
                        ? (customerModal.today.products || [])
                            .map((p) => `${p.title}${p.qty > 1 ? ` x${p.qty}` : ""}`)
                            .slice(0, 18)
                            .join(" · ")
                        : "—"}
                    </div>

                    <div className={styles.miniWrap}>
                      {(customerModal.today?.preferredByArea || []).length
                        ? (customerModal.today.preferredByArea || [])
                            .map((x) => `${x.areaName}: ${x.preferred || "—"}`)
                            .slice(0, 18)
                            .join(" · ")
                        : "—"}
                    </div>

                    <div className={styles.miniWrap}>
                      {(customerModal.today?.notesByArea || []).length
                        ? (customerModal.today.notesByArea || [])
                            .map((x) => `${x.areaName}: ${x.note}`)
                            .slice(0, 18)
                            .join(" · ")
                        : "—"}
                    </div>
                  </div>

                  <div style={{ height: 10 }} />

                  {/* Keep existing liveboard table view in modal (optional, but useful) */}
                  <div className={styles.modalTh}>
                    <div>Bereich</div>
                    <div>Status</div>
                    <div>Warten</div>
                    <div>Aktiv</div>
                  </div>

                  {(customerModal.liveboard || []).length ? (
                    (customerModal.liveboard || []).map((x) => (
                      <div key={x.id} className={styles.modalTr}>
                        <div className={styles.bold}>{x.areaName || "—"}</div>
                        <div>
                          {statusLabel(x.status)}
                          {x.staff ? <div className={styles.smallMuted}>MA: {x.staff}</div> : null}
                        </div>
                        <div className={`${styles.taRight} ${styles.mono}`}>{fmtDuration(Number(x.waitingMs || 0))}</div>
                        <div className={`${styles.taRight} ${styles.mono}`}>
                          {x.status === "active" || x.status === "done" ? fmtDuration(Number(x.activeMs || 0)) : "—"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className={styles.modalEmpty}>Kein Liveboard-Eintrag gefunden.</div>
                  )}
                </div>
              ) : null}
            </div>

            <div className={styles.overlayFoot}>
              <div className={styles.smallMuted}>
                Tipp: Tabs werden in CSS später auf schwarzer Schrift optimiert. Logik ist jetzt korrekt: History = alte Besuche, Heute = heutige Services/Produkte/Wunsch/Notizen.
              </div>
            </div>
          </div>
        </div>
      ) : null}
         {/* ✅ Premium Kundenkarte (Visit Sheet) */}
      {visitSheet.open ? (
        <VisitSheetModal
          sheet={visitSheet}
          staff={staff}
          busy={String(busyId) === String(visitSheet.rowId)}
          onClose={closeVisitSheet}
          onStaffChange={(id) => setVisitSheet((s) => ({ ...s, staffValue: id }))}
          onConfirm={async () => {
            if (visitSheet.mode === "waiting") {
              const sid = safeStr(visitSheet.staffValue);
              if (!sid) {
                showToast("Bitte Mitarbeiter wählen.");
                return;
              }
              const row = (liveRows || []).find((x) => String(x.id) === String(visitSheet.rowId));
              if (row) await take(row, sid);
              closeVisitSheet();
              return;
            }

            if (visitSheet.mode === "active") {
              const row = (liveRows || []).find((x) => String(x.id) === String(visitSheet.rowId));
              if (row) await finish(row);
              closeVisitSheet();
              return;
            }

            if (visitSheet.mode === "checkout") {
              closeVisitSheet();
              nav(`/reception/checkout?visitId=${encodeURIComponent(visitSheet.visitId)}`);
            }
          }}
          onUndo={async () => {
            const row = (liveRows || []).find((x) => String(x.id) === String(visitSheet.rowId));
            if (row) await undoToWaiting(row);
            closeVisitSheet();
          }}
          onGoCashier={() => {
            closeVisitSheet();
            nav(`/reception/checkout?visitId=${encodeURIComponent(visitSheet.visitId)}`);
          }}
        />
      ) : null}
    </div>
    
  );
}
function VisitSheetModal({ sheet, staff, busy, onClose, onConfirm, onUndo, onStaffChange, onGoCashier }) {
  const [tab, setTab] = useState("overview"); // overview | today | history | times

  useEffect(() => {
    if (sheet?.open) setTab("overview");
  }, [sheet?.open]);

  const nowTick = useNowTick(!!sheet?.open);

  const waitingMs = sheet?.waitingSince ? Math.max(0, nowTick - new Date(sheet.waitingSince).getTime()) : 0;
  const activeMs = sheet?.activeSince ? Math.max(0, nowTick - new Date(sheet.activeSince).getTime()) : 0;

  const mode = String(sheet?.mode || "");
  const title = safeStr(sheet?.title) || "—";

  const confirmLabel =
    mode === "waiting" ? "Übernehmen" : mode === "active" ? "Fertig" : mode === "checkout" ? "Zur Kasse" : "OK";

  return (
    <div className={styles.vBackdrop} role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className={styles.vSheet} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.vHead}>
          <div className={styles.vHeadLeft}>
            <div className={`${styles.vStatus} ${mode === "waiting" ? styles.vWaiting : mode === "active" ? styles.vActive : styles.vCheckout}`}>
              {mode === "waiting" ? "Warteliste" : mode === "active" ? "In Behandlung" : "Checkout"}
            </div>

            <div className={styles.vTitleRow}>
              <div className={styles.vTitle}>{title}</div>
              {sheet?.sub ? <div className={styles.vChip}>{sheet.sub}</div> : null}
            </div>

            <div className={styles.vMetaRow}>
              <span className={styles.vPill}>Check-in {fmtClock(sheet?.checkInAt)}</span>
              {mode === "waiting" ? <span className={styles.vPill}>Warten {fmtDuration(waitingMs)}</span> : null}
              {mode === "active" ? <span className={styles.vPill}>Aktiv {fmtDuration(activeMs)}</span> : null}
              {sheet?.areaName ? <span className={styles.vPill}>{sheet.areaName}</span> : null}
            </div>
          </div>

          <button className={styles.vX} type="button" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className={styles.vTabs}>
          <button type="button" className={`${styles.vTab} ${tab === "overview" ? styles.vTabOn : ""}`} onClick={() => setTab("overview")}>
            Übersicht
          </button>
          <button type="button" className={`${styles.vTab} ${tab === "today" ? styles.vTabOn : ""}`} onClick={() => setTab("today")}>
            Heute
          </button>
          <button type="button" className={`${styles.vTab} ${tab === "times" ? styles.vTabOn : ""}`} onClick={() => setTab("times")}>
            Status & Zeiten
          </button>
          <button type="button" className={`${styles.vTab} ${tab === "history" ? styles.vTabOn : ""}`} onClick={() => setTab("history")}>
            History
          </button>
          <div className={styles.vRail} />
        </div>

        <div className={styles.vBody}>
          {tab === "overview" ? (
            <div className={styles.vGrid}>
              <div className={styles.vCard}>
                <div className={styles.vLabel}>Wunsch / Behandlung</div>
                <div className={styles.vValue}>{safeStr(sheet?.wishServiceTitle) || "—"}</div>
              </div>

              <div className={styles.vCard}>
                <div className={styles.vLabel}>Wunsch-Mitarbeiter</div>
                <div className={styles.vValue}>{safeStr(sheet?.preferredStaffName) || "—"}</div>
              </div>

              <div className={styles.vCard}>
                <div className={styles.vLabel}>Zugewiesen</div>
                <div className={styles.vValue}>{safeStr(sheet?.assignedStaffName) || "—"}</div>
              </div>

              <div className={`${styles.vCard} ${styles.vWide}`}>
                <div className={styles.vLabel}>Notiz</div>
                <div className={styles.vValue}>{safeStr(sheet?.note) || "—"}</div>
              </div>

              {Array.isArray(sheet?.members) && sheet.members.length ? (
                <div className={`${styles.vCard} ${styles.vWide}`}>
                  <div className={styles.vLabel}>Mitglieder</div>
                  <div className={styles.vValue}>{sheet.members.slice(0, 12).join(" · ")}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "today" ? (
            <div className={styles.vSplit}>
              <div className={styles.vSection}>
                <div className={styles.vSectionTitle}>Behandlungen</div>
                {sheet?.services?.length ? (
                  <div className={styles.vLines}>
                    {sheet.services.slice(0, 30).map((s, idx) => (
                      <div key={`${s.title}-${idx}`} className={styles.vLine}>
                        <div className={styles.vLineLeft}>
                          <div className={styles.vLineMain}>{s.title || "—"}</div>
                          {s.note ? <div className={styles.vLineSub}>Notiz: {s.note}</div> : null}
                        </div>
                        <div className={styles.vLineRight}>{formatEUR(s.price)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.vEmpty}>— keine Services —</div>
                )}
              </div>

              <div className={styles.vSection}>
                <div className={styles.vSectionTitle}>Produkte</div>
                {sheet?.products?.length ? (
                  <div className={styles.vLines}>
                    {sheet.products.slice(0, 30).map((p, idx) => (
                      <div key={`${p.title}-${idx}`} className={styles.vLine}>
                        <div className={styles.vLineLeft}>
                          <div className={styles.vLineMain}>
                            {p.title || "—"}{p.qty > 1 ? ` ×${p.qty}` : ""}
                          </div>
                        </div>
                        <div className={styles.vLineRight}>{formatEUR(Number(p.price || 0) * Number(p.qty || 1))}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.vEmpty}>— keine Produkte —</div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "times" ? (
            <div className={styles.vTimes}>
              <div className={styles.vBigTimers}>
                <div className={styles.vTimerCard}>
                  <div className={styles.vLabel}>Wartezeit</div>
                  <div className={styles.vTimer}>{fmtDuration(waitingMs)}</div>
                  <div className={styles.vHint}>{sheet?.checkInAt ? `seit ${fmtClock(sheet.checkInAt)}` : "—"}</div>
                </div>
                <div className={styles.vTimerCard}>
                  <div className={styles.vLabel}>In Behandlung</div>
                  <div className={styles.vTimer}>{sheet?.activeSince ? fmtDuration(activeMs) : "—"}</div>
                  <div className={styles.vHint}>{sheet?.activeSince ? `seit ${fmtClock(sheet.activeSince)}` : "—"}</div>
                </div>
              </div>

              <div className={styles.vSection}>
                <div className={styles.vSectionTitle}>Bereiche heute</div>
                {sheet?.liveboard?.length ? (
                  <div className={styles.vLines}>
                    {sheet.liveboard.slice(0, 24).map((x) => (
                      <div key={x.id} className={styles.vLine}>
                        <div className={styles.vLineLeft}>
                          <div className={styles.vLineMain}>{x.areaName || "—"}</div>
                          <div className={styles.vLineSub}>
                            {statusLabel(x.status)}{x.staff ? ` · MA: ${x.staff}` : ""}
                          </div>
                        </div>
                        <div className={styles.vLineRight}>
                          {x.status === "waiting" ? fmtDuration(x.waitingMs) : x.status === "active" ? fmtDuration(x.activeMs) : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.vEmpty}>— keine Liveboard-Daten —</div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "history" ? (
            <div className={styles.vSection}>
              <div className={styles.vSectionTitle}>Alte Besuche</div>
              {sheet?.history?.length ? (
                <div className={styles.vLines}>
                  {sheet.history.map((h) => (
                    <div key={h.visitId} className={styles.vLine}>
                      <div className={styles.vLineLeft}>
                        <div className={styles.vLineMain}>{h.dateKey || "—"}</div>
                        <div className={styles.vLineSub}>
                          {fmtClock(h.createdAt)} · {h.type || "—"} · {h.status || "—"}
                          {h.note ? ` · ${h.note}` : ""}
                        </div>
                      </div>
                      <div className={styles.vLineRight}> </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.vEmpty}>— keine History —</div>
              )}
            </div>
          ) : null}
        </div>

        <div className={styles.vFoot}>
          {/* Staff picker nur wenn warteliste */}
          {mode === "waiting" ? (
            <div className={styles.vStaff}>
              <div className={styles.vLabel}>Mitarbeiter zuweisen</div>
              <select className={styles.vSelect} value={sheet?.staffValue || ""} onChange={(e) => onStaffChange?.(e.target.value)} disabled={busy}>
                <option value="">— bitte wählen —</option>
                {(staff || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className={styles.vStaffHint}>
              {mode === "active" ? "Fertig setzt Bereich auf Checkout." : mode === "checkout" ? "Zur Kasse senden." : ""}
            </div>
          )}

          <div className={styles.vActions}>
            {mode === "active" ? (
              <button type="button" className={styles.vGhost} onClick={onUndo} disabled={busy} title="Zurück auf Warteliste">
                Zurück
              </button>
            ) : null}

            {mode === "checkout" ? (
              <button type="button" className={styles.vGhost} onClick={onGoCashier} disabled={busy}>
                Direkt zur Kasse
              </button>
            ) : null}

            <button type="button" className={styles.vGhost} onClick={onClose} disabled={busy}>
              Schließen
            </button>

            <button type="button" className={styles.vPrimary} onClick={onConfirm} disabled={busy}>
              {busy ? "…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


