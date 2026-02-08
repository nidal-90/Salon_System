// src/features/reception/pages/ReceptionCheckInPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import { nextGuestDisplayName } from "../../../services/guest/guestCounter.js";
import KioskOrderEmbed from "../../kiosk/pages/KioskOrderEmbed.jsx";
import styles from "./ReceptionCheckInPage.module.css";


/** ---------- Helpers ---------- */
function safeName(c) {
  const a = String(c?.firstName || "").trim();
  const b = String(c?.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || String(c?.displayName || "").trim() || "Unbekannt";
}
async function peekNextGuestNumber() {
  const dateKey = toDateKeyISO(new Date());
  const row = await db.daily_counters.get(dateKey).catch(() => null);
  return Number(row?.guestNextNumber || 1);
}

async function commitNextGuestNumber() {
  const dateKey = toDateKeyISO(new Date());

  return db.transaction("rw", db.daily_counters, async () => {
    const row = await db.daily_counters.get(dateKey).catch(() => null);
    const current = Number(row?.guestNextNumber || 1);

    await db.daily_counters.put({
      dateKey,
      guestNextNumber: current + 1,
    });

    return current; // die “verwendete” Nummer
  });
}

function isGroupLikeCustomer(x) {
  if (!x) return false;
  const kind = String(x.kind || x.type || "").toLowerCase();

  // klarer Fall
  if (kind === "group") return true;

  // typische group/customer-mischfelder (bei dir kommen Gruppen aus "groups"-schema)
  if (x.groupId) return true;
  if (x.paymentMode) return true;
  if (x.contactFirstName || x.contactLastName) return true;

  // falls du Gruppen als "displayName/title" speicherst
  if (x.title && !x.firstName && !x.lastName) return true;

  return false;
}
function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function bestMatchGroupMember({ gid, visit, groupMembers }) {
  // groupMembers: array of db.group_members for gid
  const cid = String(visit?.customerId || "").trim();
  if (cid) {
    const gm = groupMembers.find((m) => String(m.customerId || "").trim() === cid);
    if (gm?.id) return `member:${gid}:${String(gm.id)}`;
  }

  const vName = norm(visit?.displayName);
  if (vName) {
    const gm = groupMembers.find((m) => norm(m.displayName) === vName);
    if (gm?.id) return `member:${gid}:${String(gm.id)}`;
  }

  const vPhoneDigits = onlyDigits(visit?.phone || "");
  if (vPhoneDigits) {
    const gm = groupMembers.find((m) => onlyDigits(m.phone || "") === vPhoneDigits);
    if (gm?.id) return `member:${gid}:${String(gm.id)}`;
  }

  return "";
}

function groupTitle(g) {
  if (!g) return "Gruppe";
  return String(g?.title || "").trim() || String(g?.displayName || "").trim() || "Gruppe";
}

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function pad2(n) {
  const x = Math.floor(Math.max(0, Number(n || 0)));
  return String(x).padStart(2, "0");
}

function parseAnyDate(x) {
  const ms = Date.parse(String(x || ""));
  return Number.isFinite(ms) ? ms : null;
}

function fmtClock(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtDate(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleDateString("de-DE");
  } catch {
    return "—";
  }
}

function fmtDuration(ms) {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

function normalizeStatus(x) {
  const s = String(x || "").toLowerCase();
  if (["paid", "payed"].includes(s)) return "paid";
  if (["done", "closed", "checkout_done"].includes(s)) return "paid";
  if (["checkout"].includes(s)) return "checkout";
  if (["active", "in_treatment", "treatment"].includes(s)) return "active";
  if (["waiting"].includes(s)) return "waiting";
  return s || "waiting";
}

function statusLabel(s) {
  const x = normalizeStatus(s);
  if (x === "paid") return "Bezahlt";
  if (x === "checkout") return "Checkout";
  if (x === "active") return "In Behandlung";
  return "Wartet";
}

function preferText(x) {
  const v = String(x || "").trim();
  return v ? v : "";
}




/** ---------- Robust DB details loader (schema-aware, incl. member phones + lastVisit) ---------- */
async function fetchVisitFullDetails(visitId) {
  if (!visitId) return null;

  const [visit, members, services, products, areaStates, payments] = await Promise.all([
    db.visits.get(visitId).catch(() => null),
    db.visit_members.where("visitId").equals(visitId).toArray().catch(() => []),
    db.visit_services.where("visitId").equals(visitId).toArray().catch(() => []),
    db.visit_products.where("visitId").equals(visitId).toArray().catch(() => []),
    db.visit_area_state.where("visitId").equals(visitId).toArray().catch(() => []),
    db.payments_today.where("visitId").equals(visitId).toArray().catch(() => []),
  ]);

  const customerId = visit?.customerId ? String(visit.customerId) : "";
  const visitCustomer = customerId ? await db.customers.get(customerId).catch(() => null) : null;

  // fetch member customers for accurate phone + lastVisitAt (small N)
  const memberCustomerIds = (members || [])
    .map((m) => (m?.customerId ? String(m.customerId) : ""))
    .filter(Boolean);

  const uniqMemberCustomerIds = Array.from(new Set(memberCustomerIds));
  const memberCustomers = await Promise.all(
    uniqMemberCustomerIds.map((id) => db.customers.get(id).catch(() => null))
  );

  const memberCustomerById = new Map();
  for (const c of memberCustomers) {
    if (c?.id) memberCustomerById.set(String(c.id), c);
  }

  const createdAtMs = parseAnyDate(visit?.createdAt) || null;

  const serviceLines = (services || []).map((s) => ({
    id: String(s.id || ""),
    visitId: String(s.visitId || ""),
    memberId: s.memberId ? String(s.memberId) : "",
    areaId: String(s.areaId || ""),
    title: String(s.title || "Behandlung"),
    staffId: String(s.staffId || ""),
    staffName: String(s.staffName || ""),
    startedAt: s.startedAt || "",
    endedAt: s.endedAt || "",
    note: String(s.note || ""),
  }));

  const productLines = (products || []).map((p) => ({
    id: String(p.id || ""),
    visitId: String(p.visitId || ""),
    memberId: p.memberId ? String(p.memberId) : "",
    title: String(p.title || "Produkt"),
    staffName: String(p.staffName || ""),
    qty: Number(p.qty || 1),
    note: String(p.note || ""),
  }));


  const liveboard = (areaStates || []).map((st) => ({
    id: String(st.id || ""),
    areaId: String(st.areaId || ""),
    dateKey: st.dateKey || "",
    status: normalizeStatus(st.status || "waiting"),
    preferredStaffName: String(st.preferredStaffName || ""),
    assignedStaffName: String(st.assignedStaffName || ""),
    startedAt: st.startedAt || "",
    endedAt: st.endedAt || "",
    note: String(st.note || ""),
  }));

  const phone =
    preferText(visitCustomer?.phone) ||
    preferText(visit?.phone) ||
    "";

  const lastVisitAtMs = visitCustomer?.lastVisitAt ? parseAnyDate(visitCustomer.lastVisitAt) : null;

  const mappedMembers = (members || []).map((m) => {
    const mcid = m?.customerId ? String(m.customerId) : "";
    const mc = mcid ? memberCustomerById.get(mcid) : null;
    const mPhone = preferText(m?.phone) || preferText(mc?.phone) || "";
    const mLastVisitAtMs = mc?.lastVisitAt ? parseAnyDate(mc.lastVisitAt) : null;

    return {
      id: String(m.id),
      role: String(m.role || ""),
      customerId: mcid,
      displayName: String(m.displayName || "").trim() || "Mitglied",
      phone: mPhone,
      lastVisitAtMs: mLastVisitAtMs,
      createdAt: m.createdAt || "",
    };
  });


  const paymentsMapped = (payments || []).map((p) => ({
    id: String(p.id || ""),
    visitId: String(p.visitId || ""),
    memberId: p.memberId ? String(p.memberId) : "",
    amount: Number(p.amount || 0),
    createdAt: p.createdAt || "",
    method: String(p.method || ""),
  }));

  const readyForCheckoutAtMs = parseAnyDate(visit?.readyForCheckoutAt) || null;
  const visitStatus = normalizeStatus(visit?.status || "waiting");

  // a "group visit" in your DB is typically: type=group OR visit_members length > 1
  const isGroup = String(visit?.type || "").toLowerCase() === "group" || mappedMembers.length > 1;

  return {
    visit,
    isGroup,
    customer: visitCustomer,
    phone,
    createdAtMs,
    lastVisitAtMs,
    readyForCheckoutAtMs,
    visitStatus,
    members: mappedMembers,
    serviceLines,
    productLines,
    liveboard,
    payments: paymentsMapped,
  };
}

export default function ReceptionCheckInPage() {
  const nav = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [areasCount, setAreasCount] = useState(0);
  const [reservedGuestNo, setReservedGuestNo] = useState(null);
  const [mode, setMode] = useState("customer");
  const [query, setQuery] = useState("");

  const [groups, setGroups] = useState([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  const [selectedParticipantKey, setSelectedParticipantKey] = useState("");
  const [doneMap, setDoneMap] = useState({});

  const [todayVisits, setTodayVisits] = useState([]);
  const [todayCount, setTodayCount] = useState(0);

  const [toast, setToast] = useState("");
  const [openToday, setOpenToday] = useState(false);

  // Today modal: selection + search
  const [todayQuery, setTodayQuery] = useState("");
  const [todaySelectedVisitId, setTodaySelectedVisitId] = useState("");
  const [todaySelectedMemberId, setTodaySelectedMemberId] = useState("");

  // Tabs: info|order|products|notes|status
  const [detailTab, setDetailTab] = useState("info");
  const [selectedVisitFull, setSelectedVisitFull] = useState(null);

  // live tick (1s)
  const [tick, setTick] = useState(0);

  // kiosk embed
  const [profile, setProfile] = useState(null);
  const [activeParticipantKey, setActiveParticipantKey] = useState("");
  const isKioskOpen = !!profile;

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2200);
  }

  /*async function reloadBase() {
  const dateKey = toDateKeyISO(new Date());

  const [c, a, grp, grpMembers, list] = await Promise.all([
    db.customers.toArray().catch(() => []),
    db.areas.count().catch(() => 0),
    db.groups.toArray().catch(() => []),
    db.group_members.toArray().catch(() => []),
    db.visits.where("dateKey").equals(dateKey).toArray().catch(() => []),
  ]);

  // customers
  const cleanCustomers = (c || []).filter(Boolean);
  const realCustomers = cleanCustomers.filter((x) => !isGroupLikeCustomer(x));
  realCustomers.sort((x, y) => safeName(x).localeCompare(safeName(y)));
  setCustomers(realCustomers);

  setAreasCount(a);

  // groups + members
  const groupsClean = (grp || [])
    .filter(Boolean)
    .map((g) => ({
      ...g,
      members: (grpMembers || [])
        .filter((m) => String(m.groupId) === String(g.id))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    }));

  groupsClean.sort((x, y) => String(x.title || "").localeCompare(String(y.title || "")));
  setGroups(groupsClean);

  // today visits + count
  const listClean = (list || []).filter(Boolean);

  // --- BACKFILL participantKey for older group visits (fix "Buchen" obwohl schon eingecheckt) ---
  // Build groupMembers index once (fast)
  const groupMembersByGroupId = new Map();
  for (const gm of grpMembers || []) {
    const gid = String(gm?.groupId || "").trim();
    if (!gid) continue;
    const arr = groupMembersByGroupId.get(gid) || [];
    arr.push(gm);
    groupMembersByGroupId.set(gid, arr);
  }

  // Only check open visits that are group-like and missing participantKey
  const needsFix = listClean.filter((v) => {
    const st = normalizeStatus(v?.status || "waiting");
    if (st === "paid") return false;
    const gid = String(v?.groupId || "").trim();
    if (!gid) return false;
    const pk = String(v?.participantKey || "").trim();
    return !pk;
  });

  if (needsFix.length > 0) {
    // load visit_members for all candidate visits once
    const ids = needsFix.map((v) => String(v.id)).filter(Boolean);
    const allMembers = await db.visit_members.toArray().catch(() => []);
    const membersByVisitId = new Map();
    for (const m of allMembers || []) {
      const vid = String(m?.visitId || "");
      if (!vid || !ids.includes(vid)) continue;
      const arr = membersByVisitId.get(vid) || [];
      arr.push(m);
      membersByVisitId.set(vid, arr);
    }

    for (const v of needsFix) {
      const gid = String(v.groupId).trim();
      const vid = String(v.id);

      const groupMembers = groupMembersByGroupId.get(gid) || [];
      let pk = "";

      // 1) If customerId exists -> best possible
      pk = bestMatchGroupMember({ gid, visit: v, groupMembers });

      // 2) If still empty -> decide contact vs member by visit_members roles
      if (!pk) {
        const vms = membersByVisitId.get(vid) || [];
        const hasContact = vms.some((x) => String(x.role || "").toLowerCase().includes("contact"));
        if (hasContact) {
          pk = `contact:${gid}`;
        } else {
          // Try name match from visit_members displayName
          const names = vms.map((x) => norm(x.displayName)).filter(Boolean);
          const gm = groupMembers.find((m) => names.includes(norm(m.displayName)));
          if (gm?.id) pk = `member:${gid}:${String(gm.id)}`;
        }
      }

      if (pk) {
        await db.visits.update(vid, { participantKey: pk }).catch(() => {});
        // Also patch in-memory object so UI updates immediately after reloadBase
        v.participantKey = pk;
      }
    }
  }

  listClean.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
  setTodayVisits(listClean);

  // count: offene check-ins
  setTodayCount(listClean.filter((v) => normalizeStatus(v?.status) !== "paid").length);

  listClean.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
  setTodayVisits(listClean);

  // count: offene check-ins
  setTodayCount(listClean.filter((v) => normalizeStatus(v?.status) !== "paid").length);
}*/
async function reloadBase() {
  const dateKey = toDateKeyISO(new Date());

  const [c, a, grp, grpMembers, list] = await Promise.all([
    db.customers.toArray().catch(() => []),
    db.areas.count().catch(() => 0),
    db.groups.toArray().catch(() => []),
    db.group_members.toArray().catch(() => []),
    db.visits.where("dateKey").equals(dateKey).toArray().catch(() => []),
  ]);

  // customers
  const cleanCustomers = (c || []).filter(Boolean);
  const realCustomers = cleanCustomers.filter((x) => !isGroupLikeCustomer(x));
  realCustomers.sort((x, y) => safeName(x).localeCompare(safeName(y)));
  setCustomers(realCustomers);

  setAreasCount(a);

  // ✅ groups: merge db.groups + customers(kind=group)
  const customerGroups = cleanCustomers
    .filter((x) => String(x?.kind || "") === "group" || !!x?.group)
    .map((x) => ({
      id: String(x.id),
      title: String(x.group?.title || x.displayName || x.title || "").trim(),
      phone: String(x.phone || ""),
      email: String(x.email || ""),
      paymentMode: String(x.group?.paymentMode || x.paymentMode || "single"),
      contactFirstName: String(x.firstName || x.group?.contactFirstName || ""),
      contactLastName: String(x.lastName || x.group?.contactLastName || ""),
      _src: "customers",
      _membersInline: Array.isArray(x.group?.members) ? x.group.members : [],
    }));

  const groupsFromTable = (grp || [])
    .filter(Boolean)
    .map((g) => ({
      ...g,
      id: String(g.id),
      title: String(g.title || g.displayName || "").trim(),
      _src: "groups",
    }));

  // merge by id (db.groups wins if same id exists)
  const groupById = new Map();
  for (const g of customerGroups) groupById.set(String(g.id), g);
  for (const g of groupsFromTable) groupById.set(String(g.id), g);

  const mergedGroups = Array.from(groupById.values());

  // members: prefer db.group_members, fallback to customers.group.members
  const groupsClean = mergedGroups.map((g) => {
    const gid = String(g.id);

    const membersFromTable = (grpMembers || [])
      .filter((m) => String(m.groupId) === gid)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

    const membersFallback = Array.isArray(g._membersInline)
      ? g._membersInline.map((m, idx) => ({
          id: m.id ?? undefined,
          groupId: gid,
          sortOrder: idx,
          displayName: m.displayName,
          phone: m.phone,
          customerId: m.customerId,
        }))
      : [];

    return {
      ...g,
      members: membersFromTable.length ? membersFromTable : membersFallback,
    };
  });

  groupsClean.sort((x, y) => String(x.title || "").localeCompare(String(y.title || "")));
  setGroups(groupsClean);

  // -------------------------------
  // ✅ TODAY VISITS + BACKFILL participantKey (CRITICAL FIX)
  // -------------------------------
  const listClean = (list || []).filter(Boolean);

  // Build group members index from groupsClean (works for both schemas)
  const membersByGroupId = new Map(); // gid -> [{id, idx, customerId, displayName, phone}]
  for (const g of groupsClean) {
    const gid = String(g?.id || "").trim();
    if (!gid) continue;
    const arr = Array.isArray(g?.members) ? g.members : [];
    const mapped = arr.map((m, idx) => {
      const stableId = String(m?.id ?? idx);
      return {
        stableId,                 // used in participantKey
        idx,                      // legacy index
        customerId: String(m?.customerId || "").trim(),
        displayName: String(m?.displayName || "").trim(),
        phone: String(m?.phone || "").trim(),
      };
    });
    membersByGroupId.set(gid, mapped);
  }

  // Only open group visits missing participantKey
  const candidates = listClean.filter((v) => {
    const st = normalizeStatus(v?.status || "waiting");
    if (st === "paid") return false;
    const gid = String(v?.groupId || "").trim();
    if (!gid) return false;
    const pk = String(v?.participantKey || "").trim();
    const looksValid =
  pk.startsWith(`contact:${gid}`) ||
  pk.startsWith(`member:${gid}:`);
    return !pk;
  });

  if (candidates.length > 0) {
    // load visit_members once (only if needed)
    const allVisitMembers = await db.visit_members.toArray().catch(() => []);
    const byVisitId = new Map();
    for (const m of allVisitMembers || []) {
      const vid = String(m?.visitId || "");
      if (!vid) continue;
      const arr = byVisitId.get(vid) || [];
      arr.push(m);
      byVisitId.set(vid, arr);
    }

    const pickNameTail = (s) => {
      const t = String(s || "").trim();
      if (!t) return "";
      // examples: "Hochzeit Konsti · Konsti k" -> "Konsti k"
      const parts = t.split("·").map((x) => x.trim()).filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 1] : t;
    };

    for (const v of candidates) {
      const vid = String(v?.id || "").trim();
      const gid = String(v?.groupId || "").trim();
      if (!vid || !gid) continue;

      const groupMembers = membersByGroupId.get(gid) || [];
      let pk = "";

      // 1) Best: customerId matches a member
      const cid = String(v?.customerId || "").trim();
      if (cid) {
        const gm = groupMembers.find((m) => m.customerId && m.customerId === cid);
        if (gm) pk = `member:${gid}:${gm.stableId}`;
      }

      // 2) Name match (visit.displayName tail or visit_members displayName)
      if (!pk) {
        const vTail = norm(pickNameTail(v?.displayName));
        if (vTail) {
          const gm = groupMembers.find((m) => norm(m.displayName) === vTail);
          if (gm) pk = `member:${gid}:${gm.stableId}`;
        }
      }

      // 3) Phone match (digits)
      if (!pk) {
        const vDigits = onlyDigits(v?.phone || "");
        if (vDigits) {
          const gm = groupMembers.find((m) => onlyDigits(m.phone || "") === vDigits);
          if (gm) pk = `member:${gid}:${gm.stableId}`;
        }
      }

      // 4) visit_members roles: contact?
      if (!pk) {
        const vms = byVisitId.get(vid) || [];
        const hasContact = vms.some((x) => String(x?.role || "").toLowerCase().includes("contact"));
        if (hasContact) {
          pk = `contact:${gid}`;
        } else {
          // fallback: try member name from visit_members
          const names = (vms || []).map((x) => norm(x?.displayName)).filter(Boolean);
          const gm = groupMembers.find((m) => names.includes(norm(m.displayName)));
          if (gm) pk = `member:${gid}:${gm.stableId}`;
        }
      }

      if (pk) {
        await db.visits.update(vid, { participantKey: pk }).catch(() => {});
        v.participantKey = pk; // patch in-memory for immediate UI
      }
    }
  }

  // sort + state
  listClean.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
  setTodayVisits(listClean);
  setTodayCount(listClean.filter((v) => normalizeStatus(v?.status) !== "paid").length);
}



  useEffect(() => {
    reloadBase();
  }, []);

  useEffect(() => {
    if (!openToday) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [openToday]);

  const customerById = useMemo(() => {
    const m = new Map();
    for (const c of customers) m.set(String(c?.id || ""), c);
    return m;
  }, [customers]);

const openVisitByCustomerId = useMemo(() => {
  const m = new Map();
  for (const v of todayVisits || []) {
    const cid = v?.customerId ? String(v.customerId) : "";
    if (!cid) continue;

    const st = normalizeStatus(v?.status || "waiting");
    if (st === "paid") continue;

    const cur = m.get(cid);
    if (!cur) m.set(cid, v);
    else if (String(v.createdAt || "").localeCompare(String(cur.createdAt || "")) > 0) m.set(cid, v);
  }
  return m;
}, [todayVisits]);

  /** Open visit by customer today */
  const openVisitByGroupParticipant = useMemo(() => {
  const m = new Map(); // key = `${groupId}||${participantKey}` => visit
  for (const v of todayVisits) {
    const st = normalizeStatus(v?.status || "waiting");
    if (st === "paid") continue;

    const gid = String(v?.groupId || "");
    const pk = String(v?.participantKey || "");
    if (!gid || !pk) continue;

    const key = `${gid}||${pk}`;

    // nimm den neuesten (falls mehrere)
    const cur = m.get(key);
    if (!cur) {
      m.set(key, v);
    } else {
      const a = String(cur.createdAt || "");
      const b = String(v.createdAt || "");
      if (b.localeCompare(a) > 0) m.set(key, v);
    }
  }
  return m;
}, [todayVisits]);

const openVisitsByGroupId = useMemo(() => {
  const m = new Map(); // gid -> latest open visit (or array if you want)
  for (const v of todayVisits || []) {
    const st = normalizeStatus(v?.status || "waiting");
    if (st === "paid") continue;

    const gid = String(v?.groupId || "").trim();
    if (!gid) continue;

    const cur = m.get(gid);
    if (!cur) m.set(gid, v);
    else if (String(v.createdAt || "").localeCompare(String(cur.createdAt || "")) > 0) m.set(gid, v);
  }
  return m;
}, [todayVisits]);

const openVisitByGroupAndCustomerId = useMemo(() => {
  const m = new Map(); // key = `${gid}||${customerId}` -> latest open visit
  for (const v of todayVisits || []) {
    const st = normalizeStatus(v?.status || "waiting");
    if (st === "paid") continue;

    const gid = String(v?.groupId || "").trim();
    const cid = String(v?.customerId || "").trim();
    if (!gid || !cid) continue;

    const key = `${gid}||${cid}`;
    const cur = m.get(key);
    if (!cur) m.set(key, v);
    else if (String(v.createdAt || "").localeCompare(String(cur.createdAt || "")) > 0) m.set(key, v);
  }
  return m;
}, [todayVisits]);

const findOpenVisitForParticipant = (gid, p) => {
  const groupId = String(gid || "").trim();
  if (!groupId || !p) return null;

  // 1) primary participantKey
  let v = openVisitByGroupParticipant.get(`${groupId}||${String(p.key)}`);
  if (v) return v;

  // 2) legacy keys
  const legacy = Array.isArray(p.legacyKeys) ? p.legacyKeys : [];
  for (const k of legacy) {
    v = openVisitByGroupParticipant.get(`${groupId}||${String(k)}`);
    if (v) return v;
  }

  // 3) customerId fallback
  if (p.customerId) {
    v = openVisitByGroupAndCustomerId.get(`${groupId}||${String(p.customerId)}`);
    if (v) return v;
  }

  // 4) ✅ displayName fallback (wenn participantKey fehlt/anders ist)
  // Erwartet pattern: "GruppenTitle · MitgliedName"
  const needle = `· ${String(p.displayName || "").trim()}`.toLowerCase();
  const hit = (todayVisits || []).find((x) => {
    const st = normalizeStatus(x?.status || "waiting");
    if (st === "paid") return false;
    if (String(x?.groupId || "").trim() !== groupId) return false;
    const dn = String(x?.displayName || "").toLowerCase();
    return needle && dn.includes(needle);
  });

  return hit || null;
};



const todayGuestVisits = useMemo(() => {
  return (todayVisits || [])
    .filter((v) => normalizeStatus(v?.status) !== "paid")
    .filter((v) => !String(v?.customerId || "").trim())
    .filter((v) => !String(v?.groupId || "").trim())
    .filter((v) => String(v?.displayName || "").toLowerCase().startsWith("gast"));
}, [todayVisits]);

  /** Customers search */
  const filteredCustomers = useMemo(() => {
    const qx = query.trim().toLowerCase();
    const base = customers.filter((x) => String(x?.kind || "") !== "group" && !x?.group);
    if (!qx) return [];
    return base.filter((c) => {
      const n = safeName(c).toLowerCase();
      const p = String(c.phone || "").toLowerCase();
      const e = String(c.email || "").toLowerCase();
      return n.includes(qx) || p.includes(qx) || e.includes(qx);
    });
  }, [customers, query]);

  /** Groups search */
  const filteredGroups = useMemo(() => {
    const qx = groupQuery.trim().toLowerCase();
    if (!qx) return [];
    return groups.filter((g) => {
      const n = groupTitle(g).toLowerCase();
      const p = String(g.phone || "").toLowerCase();
      const e = String(g.email || g?.group?.email || "").toLowerCase();
      const meta = JSON.stringify(g || {}).toLowerCase();
      return n.includes(qx) || p.includes(qx) || e.includes(qx) || meta.includes(qx);
    });
  }, [groups, groupQuery]);

  /** Group selection for kiosk */
  const selectedGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return groups.find((g) => String(g.id) === String(selectedGroupId)) || null;
  }, [groups, selectedGroupId]);

  const selectedGroupMembers = useMemo(() => {
  const arr = selectedGroup?.members;
  return Array.isArray(arr) ? arr : [];
}, [selectedGroup]);

const groupPaymentMode = useMemo(() => {
  const pm = String(selectedGroup?.paymentMode || "single"); 
  return pm === "split" ? "split" : "single";
}, [selectedGroup]);


const participants = useMemo(() => {
  if (!selectedGroup) return [];
  const gid = String(selectedGroup.id);

  const contactName = `${String(selectedGroup?.contactFirstName || "").trim()} ${String(
    selectedGroup?.contactLastName || ""
  ).trim()}`.trim();

  const contact = {
    kind: "contact",
    key: `contact:${gid}`,
    legacyKeys: [],
    displayName: contactName || "Kontakt",
    phone: String(selectedGroup.phone || ""),
    customerId: "",
    tag: "Gruppen Master",
  };

  const members = selectedGroupMembers.map((m, idx) => {
    const stableId = String(m?.id || idx); // group_members.id bevorzugt
    const key = `member:${gid}:${stableId}`; // stabil
    const legacyKeys = [
  `member:${gid}:${idx}`,           // alte index-basierte keys
  `member:${gid}:${idx + 1}`,       // häufige off-by-one
  `member:${gid}:${stableId}`,      // falls stableId mal idx war
  m?.sortOrder != null ? `member:${gid}:${Number(m.sortOrder)}` : "",
].filter(Boolean);


    return {
      kind: "member",
      key,
      legacyKeys,
      displayName: String(m?.displayName || "").trim() || `Mitglied ${idx + 1}`,
      phone: String(m?.phone || ""),
      customerId: m?.customerId ? String(m.customerId) : "",
      tag: "Mitglied",
      index: idx,
    };
  });

  return [contact, ...members];
}, [selectedGroup, selectedGroupMembers]);


const groupById = useMemo(() => {
  const m = new Map();
  for (const g of groups) m.set(String(g.id), g);
  return m;
}, [groups]);

function visitDisplayName(v) {
  const gid = v?.groupId ? String(v.groupId) : "";
  if (gid) {
    const g = groupById.get(gid);
    const title = String(g?.title || "").trim();
    if (title) return title;
  }
  return String(v?.displayName || "").trim() || (v?.customerId ? `Kunde ${v.customerId}` : "Gast");
}
/*
function isGroupVisit(v) {
  if (String(v?.groupId || "").trim()) return true;
  const stType = String(v?.type || "").toLowerCase();
  const vid = String(v?.id || "");
  const mem = todayMembersIndex.get(vid) || [];
  return stType === "group" || mem.length > 1;
}*/

  const doneCount = useMemo(() => {
  if (!selectedGroup) return 0;
  const gid = String(selectedGroup.id);

  return participants.reduce((acc, p) => {
  const open = findOpenVisitForParticipant(gid, p);

   return acc + (open || doneMap[p.key] ? 1 : 0);
  }, 0);
}, [participants, doneMap, selectedGroup, openVisitByGroupParticipant, openVisitByGroupAndCustomerId]);

const allDone = useMemo(() => {
  return participants.length > 0 && doneCount === participants.length;
}, [participants.length, doneCount]);


  function resetStep2() {
    setProfile(null);
    setActiveParticipantKey("");
  }
  function resetGroupFlow() {
    setSelectedGroupId("");
    setSelectedParticipantKey("");
    setDoneMap({});
    resetStep2();
  }

  useEffect(() => {
    resetStep2();
    if (mode !== "group") resetGroupFlow();
    if (mode !== "customer") setQuery("");
  }, [mode]);

  useEffect(() => {
    setSelectedParticipantKey("");
    setDoneMap({});
    resetStep2();
  }, [selectedGroupId]);

  /** Start flows */
  function startCustomer(c) {
    if (!c) return;
    const openVisit = openVisitByCustomerId.get(String(c.id)) || null;
    setProfile({
      mode: "existing",
      customerId: c.id,
      displayName: safeName(c),
      customer: { phone: String(c.phone || "") },
      meta: { visitId: openVisit?.id || null, isEdit: !!openVisit },
    });
    setActiveParticipantKey("");
  }

async function startGuest() {
  try {
    const n = await peekNextGuestNumber();   // nur lesen, NICHT erhöhen
    setReservedGuestNo(n);

    setProfile({
      mode: "guest",
      customerId: null,
      displayName: `Gast ${n}`,
      customer: { phone: "" },
      meta: { visitId: null, isEdit: false },
    });

    setActiveParticipantKey("");
  } catch (e) {
    showToast(`Gast konnte nicht gestartet werden: ${String(e?.message || e)}`);
  }
}
function closeKiosk() {
  setProfile(null);
  setActiveParticipantKey("");
  setReservedGuestNo(null);  // <- wichtig: Reservierung verwerfen
  if (mode === "group") setSelectedParticipantKey("");
}

function editGuestVisit(v) {
  if (!v?.id) return;

  setReservedGuestNo(null); // wichtig: falls ein Gast reserviert war
  setProfile({
    mode: "guest",
    customerId: null,
    displayName: String(v.displayName || "Gast"),
    customer: { phone: "" },
    meta: { visitId: String(v.id), isEdit: true },
  });
  setActiveParticipantKey("");
}


function startGroupParticipant(p) {
  try {
    if (!selectedGroup || !p) return;

    const title = groupTitle(selectedGroup);
    const display = `${title} · ${p.displayName}`.trim();

    setSelectedParticipantKey(p.key);

    const existing = findOpenVisitForParticipant(String(selectedGroup.id), p);

    const baseMeta = {
      groupId: String(selectedGroup.id),
      groupTitle: title,
      paymentMode: groupPaymentMode,
      participantKey: p.key,
      participantRole: p.tag,
      visitId: existing?.id || null,
      isEdit: !!existing,
    };

    if (p.customerId && p.kind === "member") {
      setProfile({
        mode: "existing",
        customerId: p.customerId,
        displayName: display,
        customer: { phone: String(p.phone || "") },
        meta: baseMeta,
      });
    } else {
      setProfile({
        mode: "guest",
        customerId: null,
        displayName: display,
        customer: { phone: String(p.phone || "") },
        meta: baseMeta,
      });
    }

    setActiveParticipantKey(p.key);
  } catch (e) {
    showToast(`Kiosk konnte nicht geöffnet werden: ${String(e?.message || e)}`);
  }
}



  async function onCheckInDone() {
    if (profile?.mode === "guest" && reservedGuestNo != null) {
    await commitNextGuestNumber();
    setReservedGuestNo(null);
  }
    if (mode === "group" && selectedGroup && activeParticipantKey) {
      const p = participants.find((x) => x.key === activeParticipantKey);
      showToast(`${p?.displayName || "Person"} eingecheckt.`);
      setDoneMap((prev) => ({ ...prev, [activeParticipantKey]: true }));
      resetStep2();
      await reloadBase();

      const pending = participants.filter((x) => !doneMap[x.key] && x.key !== activeParticipantKey);
      const choose = pending[0] || null;
      if (choose) setSelectedParticipantKey(choose.key);

      const allWillBeDone = participants.length > 0 && participants.every((x) => (x.key === activeParticipantKey ? true : !!doneMap[x.key]));
      if (allWillBeDone) {
        showToast("Gruppe komplett eingecheckt.");
        resetGroupFlow();
      }
      return;
    }

    showToast("Gespeichert.");
    setProfile(null);
    setSelectedGroupId("");
    setGroupQuery("");
    setSelectedParticipantKey("");
    setDoneMap({});
    setMode("customer");
    await reloadBase();
  }

  /** ---------- Today modal: load visit_members index for ALL today visits ---------- */
  const [todayMembersIndex, setTodayMembersIndex] = useState(new Map()); // visitId -> members[]
  useEffect(() => {
    if (!openToday) return;

    (async () => {
      const visitIds = (todayVisits || []).map((v) => String(v?.id || "")).filter(Boolean);
      if (visitIds.length === 0) {
        setTodayMembersIndex(new Map());
        return;
      }

      const all = await db.visit_members.toArray().catch(() => []);
      const map = new Map();

      const visitSet = new Set(visitIds);
      for (const m of all || []) {
        const vid = String(m?.visitId || "");
        if (!vid || !visitSet.has(vid)) continue;
        const arr = map.get(vid) || [];
        arr.push({
          id: String(m.id),
          role: String(m.role || ""),
          customerId: m.customerId ? String(m.customerId) : "",
          displayName: String(m.displayName || "").trim() || "Mitglied",
          phone: String(m.phone || "").trim(),
          createdAt: m.createdAt || "",
        });
        map.set(vid, arr);
      }

      // stable: contact first (role contains contact)
      for (const [vid, arr] of map.entries()) {
        arr.sort((a, b) => {
          const ac = String(a.role || "").toLowerCase().includes("contact") ? -1 : 0;
          const bc = String(b.role || "").toLowerCase().includes("contact") ? -1 : 0;
          if (ac !== bc) return ac - bc;
          return String(a.displayName).localeCompare(String(b.displayName));
        });
        map.set(vid, arr);
      }

      setTodayMembersIndex(map);
    })();
  }, [openToday, todayVisits]);


function isGroupVisit(v) {
  const stType = String(v?.type || "").toLowerCase();
  const vid = String(v?.id || "");
  const mem = todayMembersIndex.get(vid) || [];
  return stType === "group" || mem.length > 1 || !!String(v?.groupId || "").trim();
}


  /** Today modal: open + load */
  async function openTodayDetails(visitId, memberId = "") {
    const vid = String(visitId || "");
    if (!vid) return;

    setTodaySelectedVisitId(vid);
    setTodaySelectedMemberId(memberId ? String(memberId) : "");
    setDetailTab("info");
    setSelectedVisitFull(null);

    const full = await fetchVisitFullDetails(vid);
    setSelectedVisitFull(full);

    const filteredProducts = memberId
      ? (full?.productLines || []).filter((p) => String(p.memberId || "") === String(memberId))
      : (full?.productLines || []);
    if (filteredProducts.length === 0 && detailTab === "products") setDetailTab("order");
  }

  function resetTodayModal() {
    setOpenToday(false);
    setTodayQuery("");
    setTodaySelectedVisitId("");
    setTodaySelectedMemberId("");
    setSelectedVisitFull(null);
    setDetailTab("info");
  }

  /** Active member (for modal filtering + info) */
  const activeMember = useMemo(() => {
    if (!selectedVisitFull || !todaySelectedMemberId) return null;
    return (selectedVisitFull.members || []).find((m) => String(m.id) === String(todaySelectedMemberId)) || null;
  }, [selectedVisitFull, todaySelectedMemberId]);

  const shownServices = useMemo(() => {
    if (!selectedVisitFull) return [];
    const all = selectedVisitFull.serviceLines || [];
    if (!todaySelectedMemberId) return all;
    return all.filter((s) => String(s.memberId || "") === String(todaySelectedMemberId));
  }, [selectedVisitFull, todaySelectedMemberId]);

  const shownProducts = useMemo(() => {
    if (!selectedVisitFull) return [];
    const all = selectedVisitFull.productLines || [];
    if (!todaySelectedMemberId) return all;
    return all.filter((p) => String(p.memberId || "") === String(todaySelectedMemberId));
  }, [selectedVisitFull, todaySelectedMemberId]);

  /** Group overview mode (no member selected) */
  const isGroupOverview = useMemo(
    () => !!(selectedVisitFull?.isGroup && !todaySelectedMemberId),
    [selectedVisitFull, todaySelectedMemberId]
  );

  /** Staff line under treatment name:
      - if ended/checkout/paid => show actual staff (assigned/stored)
      - else if wish => show wish
      - else => "Freie Mitarbeiterauswahl"
  */
 function staffLineForService(full, svc) {
  const areaSt =
    (full?.liveboard || []).find((x) => String(x.areaId) === String(svc.areaId)) || null;

  const st = normalizeStatus(areaSt?.status || "");
  const ended = !!svc?.endedAt;

  // ✅ WICHTIG:
  // Wunsch kann entweder in visit_area_state.preferredStaffName ODER pro Service-Zeile in visit_services.staffName stehen.
  const desired =
    preferText(areaSt?.preferredStaffName) ||
    preferText(svc?.staffName) || // <- fallback (dein Bugfix)
    "";

  // Assigned ist "real" sobald Behandlung läuft/zugewiesen wurde
  const assigned =
    preferText(areaSt?.assignedStaffName) ||
    ""; // bewusst NICHT svc.staffName hier, sonst überschreibt Wunsch ggf. echte Zuweisung

  // Wenn Behandlung vorbei / Checkout / Paid -> zeige finalen Mitarbeiter (assigned), fallback auf svc.staffName
  if (ended || st === "checkout" || st === "paid") {
    const finalStaff = assigned || preferText(svc?.staffName) || "";
    return finalStaff ? `Mitarbeiter: ${finalStaff}` : "Mitarbeiter: —";
  }

  // Solange offen: Wunsch zeigen, wenn vorhanden
  if (desired) return `Wunsch: ${desired}`;

  return "Freie Mitarbeiterauswahl";
}

  /** Notes: visit.note + line notes (member-aware, and group overview grouped by member) */
 const notesBlock = useMemo(() => {
  if (!selectedVisitFull) return { has: false, text: "", hasVisitNote: false, visitNote: "" };

  const visitNote = preferText(selectedVisitFull?.visit?.note);
  const hasVisitNote = !!visitNote;

  // only line notes here (NO visit-level note)
  const svcNotes = (shownServices || [])
    .map((s) => preferText(s.note))
    .filter(Boolean)
    .map((t) => `• Behandlung: ${t}`);

  const prodNotes = (shownProducts || [])
    .map((p) => preferText(p.note))
    .filter(Boolean)
    .map((t) => `• Produkt: ${t}`);

  const parts = [...svcNotes, ...prodNotes];
  const text = parts.join("\n");

  return { has: !!text.trim(), text, hasVisitNote, visitNote };
}, [selectedVisitFull, shownServices, shownProducts]);

  const notesByMember = useMemo(() => {
    if (!selectedVisitFull) return [];

    // only relevant for group overview
    if (!isGroupOverview) return [];

    const members = selectedVisitFull.members || [];
    const allServices = selectedVisitFull.serviceLines || [];
    const allProducts = selectedVisitFull.productLines || [];

    return members
      .map((m) => {
        const svc = allServices.filter((s) => String(s.memberId || "") === String(m.id));
        const pro = allProducts.filter((p) => String(p.memberId || "") === String(m.id));

        const parts = [];
        // visit-level note not duplicated per member; show once at top (handled in UI)
        const svcNotes = svc.map((s) => preferText(s.note)).filter(Boolean).map((t) => `• Behandlung: ${t}`);
        const prodNotes = pro.map((p) => preferText(p.note)).filter(Boolean).map((t) => `• Produkt: ${t}`);
        parts.push(...svcNotes, ...prodNotes);

        const text = parts.join("\n");
        return {
          memberId: String(m.id),
          name: String(m.displayName || "Mitglied"),
          text,
          has: !!text.trim(),
        };
      })
      .filter((x) => x.has);
  }, [selectedVisitFull, isGroupOverview]);

  /** Status rows: one "card row" per treatment, live timers */
  const statusRows = useMemo(() => {
    if (!selectedVisitFull) return [];

    const now = Date.now();
    const memberId = todaySelectedMemberId ? String(todaySelectedMemberId) : "";

    const payLines = (selectedVisitFull.payments || []).filter((p) => (memberId ? String(p.memberId || "") === memberId : true));
    const lastPayMs =
      payLines
        .map((p) => parseAnyDate(p.createdAt))
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;

    const isPaid = normalizeStatus(selectedVisitFull.visitStatus) === "paid" || !!lastPayMs;

    const states = Array.isArray(selectedVisitFull.liveboard) ? selectedVisitFull.liveboard : [];
    const stateByAreaId = new Map();
    for (const st of states) {
      const key = String(st.areaId || "");
      if (!key) continue;
      const rank = (x) => (x === "active" ? 3 : x === "checkout" ? 2 : x === "waiting" ? 1 : 0);
      const cur = stateByAreaId.get(key);
      if (!cur || rank(st.status) > rank(cur.status)) stateByAreaId.set(key, st);
    }

    const createdAtMs = selectedVisitFull.createdAtMs || null;

    return (shownServices || []).map((svc) => {
      const areaId = String(svc.areaId || "");
      const st = areaId ? stateByAreaId.get(areaId) : null;

      let phase = "waiting";
      let sinceMs = createdAtMs;

      if (isPaid) {
        phase = "paid";
        sinceMs = lastPayMs || selectedVisitFull.readyForCheckoutAtMs || createdAtMs;
      } else if (st?.status === "checkout") {
        phase = "checkout";
        sinceMs = parseAnyDate(st.startedAt) || selectedVisitFull.readyForCheckoutAtMs || createdAtMs;
      } else if (st?.status === "active") {
        phase = "active";
        sinceMs = parseAnyDate(st.startedAt) || createdAtMs;
      } else {
        phase = "waiting";
        sinceMs = createdAtMs;
      }

      const elapsed = sinceMs ? Math.max(0, now - sinceMs) : 0;

      const desired = preferText(st?.preferredStaffName) || preferText(svc?.staffName) || "";

      const assigned = preferText(st?.assignedStaffName) || preferText(svc?.staffName) || "";
      const staffHint = desired ? `Wunsch: ${desired}` : assigned ? `MA: ${assigned}` : "";

      return {
        id: svc.id,
        memberId: String(svc.memberId || ""),
        title: svc.title,
        staffHint,
        phase,
        phaseLabel: statusLabel(phase),
        sinceClock: fmtClock(sinceMs),
        counter: sinceMs ? fmtDuration(elapsed) : "—",
      };
    });
  }, [selectedVisitFull, shownServices, todaySelectedMemberId, tick]);

  const statusByMember = useMemo(() => {
    if (!selectedVisitFull) return [];
    if (!isGroupOverview) return [];

    const members = selectedVisitFull.members || [];
    const map = new Map();
    for (const m of members) map.set(String(m.id), { member: m, rows: [] });

    for (const r of statusRows) {
      const key = String(r.memberId || "");
      if (!map.has(key)) map.set(key, { member: { id: key, displayName: "Mitglied" }, rows: [] });
      map.get(key).rows.push(r);
    }

    // only show members that have rows
    const out = Array.from(map.values()).filter((x) => (x.rows || []).length > 0);
    // stable sort
    out.sort((a, b) => String(a.member?.displayName || "").localeCompare(String(b.member?.displayName || "")));
    return out;
  }, [selectedVisitFull, isGroupOverview, statusRows]);

  /** Today modal LEFT: groups + members inline under group */
  const todayLeftTree = useMemo(() => {
    const q = todayQuery.trim().toLowerCase();
    const qDigits = onlyDigits(q);

    const wantsPhone = qDigits.length >= 3;
    const wantsEmail = q.includes("@");

    const rows = [];

    for (const v of todayVisits || []) {
      const vid = String(v?.id || "");
      if (!vid) continue;

      const dn = visitDisplayName(v);
      const group = isGroupVisit(v);

      const cid = v?.customerId ? String(v.customerId) : "";
      const c = cid ? customerById.get(cid) : null;
      const phone = String(c?.phone || "").trim();
      const email = String(c?.email || "").trim();

      const members = todayMembersIndex.get(vid) || [];
      const memberCount = members.length;

      const groupMatches =
        !q ||
        dn.toLowerCase().includes(q) ||
        (wantsPhone && phone.toLowerCase().includes(qDigits)) ||
        (wantsEmail && email.toLowerCase().includes(q));

      const memberHits = group
        ? members.filter((m) => {
            const n = String(m.displayName || "").toLowerCase();
            const p = String(m.phone || "").toLowerCase();
            return !q ? true : n.includes(q) || (wantsPhone && p.includes(qDigits));
          })
        : [];

      const matches = group ? (groupMatches || memberHits.length > 0) : groupMatches;
      if (!matches) continue;

      const title = group ? `${dn} (Gruppe)` : dn;

      const meta = group
        ? `${memberCount} Mitglied${memberCount === 1 ? "" : "er"}`
        : (wantsPhone && phone ? `Tel: ${phone}` : wantsEmail && email ? email : "");

      const isSelectedGroup = group && todaySelectedVisitId === vid;
      const showMembersInline = group && (isSelectedGroup || (q && memberHits.length > 0));

      rows.push({
        kind: group ? "group" : "visit",
        visitId: vid,
        title,
        meta,
        createdAt: String(v?.createdAt || ""),
        membersInline: showMembersInline ? (q ? memberHits : members) : [],
      });
    }

    rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return rows;
  }, [todayQuery, todayVisits, todayMembersIndex, customerById, todaySelectedVisitId]);

  /** Overlay right: correct phone + last visit for active member, group contact on group overview */
  const infoName = useMemo(() => {
    if (!selectedVisitFull) return "—";
    if (activeMember) return activeMember.displayName || "—";

    if (selectedVisitFull.isGroup) {
      const contact =
        (selectedVisitFull.members || []).find((m) =>
          String(m.role || "").toLowerCase().includes("contact")
        ) || null;

      return (
        preferText(contact?.displayName) ||
        String(selectedVisitFull.visit?.displayName || "").trim() ||
        "—"
      );
    }

    return String(selectedVisitFull.visit?.displayName || "").trim() || "—";
  }, [selectedVisitFull, activeMember]);

  const infoPhone = useMemo(() => {
    if (!selectedVisitFull) return "—";
    if (activeMember) return activeMember.phone || "—";

    if (selectedVisitFull.isGroup) {
      const contact =
        (selectedVisitFull.members || []).find((m) =>
          String(m.role || "").toLowerCase().includes("contact")
        ) || null;

      const p = preferText(contact?.phone) || preferText(selectedVisitFull.phone);
      return p || "—";
    }

    return preferText(selectedVisitFull.phone) || "—";
  }, [selectedVisitFull, activeMember]);

  const infoLastVisit = useMemo(() => {
    if (!selectedVisitFull) return "—";
    const ms = activeMember?.lastVisitAtMs ?? selectedVisitFull.lastVisitAtMs ?? null;
    return ms ? fmtDate(ms) : "—";
  }, [selectedVisitFull, activeMember]);

  const infoCheckIn = useMemo(() => {
    if (!selectedVisitFull) return "—";
    return fmtClock(selectedVisitFull.createdAtMs);
  }, [selectedVisitFull]);

  /** Search display rules (main lists) */
  const customerSearch = query.trim();
  const customerDigits = onlyDigits(customerSearch);
  const showCustomerPhone = customerDigits.length >= 3;
  const showCustomerEmail = customerSearch.includes("@");

  const grpSearch = groupQuery.trim();
  const grpDigits = onlyDigits(grpSearch);
  const showGroupPhone = grpDigits.length >= 3;
  const showGroupEmail = grpSearch.includes("@");

  return (
    <div className={styles.wrap}>
      <div className={styles.shell}>
        {/* Minimal header */}
        <div className={styles.head}>
          <div>
            <div className={styles.title}>Check-in</div>
          </div>
           <div className={styles.headerActions}>
                    <button className={styles.primaryBtn} type="button" onClick={() => nav("/reception/register")}>
                      +Kunde anlegen
                    </button>
                  </div>
          <div style={{ display: "none" }} />
        </div>

        {toast ? <div className={styles.toast}>{toast}</div> : null}

        {/* KPI Row */}
        <div className={styles.kpiRow}>
          <button
            className={`${styles.kpi} ${styles.kpiBtn}`}
            type="button"
            onClick={() => {
              setOpenToday(true);
              setTodayQuery("");
              setTodaySelectedVisitId("");
              setTodaySelectedMemberId("");
              setSelectedVisitFull(null);
              setDetailTab("info");
            }}
          >
            <div className={styles.kpiLabel}>Check-ins heute</div>
            <div className={styles.kpiVal}>{todayCount}</div>
          </button>

          <div className={styles.kpi}>
             <div className={styles.kpiLabel}>Kunden</div>
             <div className={styles.kpiVal}>{customers.length}</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Mitarbeiter</div>
            <div className={styles.kpiVal}>{areasCount}</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Modus</div>
            <div className={styles.kpiVal}>{mode === "customer" ? "Kunde" : mode === "guest" ? "Gast" : "Gruppe"}</div>
          </div>
        </div>

        {/* Panel */}
        <div className={styles.panelWide}>
          <div className={styles.panelHead}>
            <div>{isKioskOpen ? <button type="button" className={styles.ghost} onClick={closeKiosk}>Zurück</button> : null}</div>

            <div className={styles.modeRow}>
              <button className={`${styles.pill} ${mode === "customer" ? styles.pillOn : ""}`} onClick={() => setMode("customer")} type="button" disabled={isKioskOpen}>
                Kunde
              </button>
              <button className={`${styles.pill} ${mode === "group" ? styles.pillOn : ""}`} onClick={() => setMode("group")} type="button" disabled={isKioskOpen}>
                Gruppe
              </button>
              <button className={`${styles.pill} ${mode === "guest" ? styles.pillOn : ""}`} onClick={() => setMode("guest")} type="button" disabled={isKioskOpen}>
                Gast
              </button>
            </div>
          </div>

          {/* KIOSK */}
          {isKioskOpen ? (
            <div className={styles.embed}>
              <KioskOrderEmbed profile={profile} onDone={onCheckInDone} />
            </div>
          ) : null}

          {/* CUSTOMER */}
          {!isKioskOpen && mode === "customer" ? (
            <>
              <div className={styles.searchRow}>
                <input
                  className={styles.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Kunde suchen… (Name / Tel / E-Mail)"
                  inputMode={onlyDigits(query).length ? "numeric" : "text"}
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>

              {customerSearch.length === 0 ? (
                <div className={styles.note}>Name oder Telefonnummer eingeben.</div>
              ) : (
                <div className={styles.list}>
                  {filteredCustomers.length === 0 ? (
                    <div className={styles.emptyInline}>Kein Treffer.</div>
                  ) : (
                    filteredCustomers.map((c) => {
                      const openVisit = openVisitByCustomerId.get(String(c.id)) || null;

                      const phoneLine = showCustomerPhone && c.phone ? `Tel: ${c.phone}` : "";
                      const emailLine = showCustomerEmail && c.email ? String(c.email) : "";
                      const metaLine = phoneLine || emailLine;

                      return (
                        <button
  key={c.id}
  className={`${styles.row} ${openVisit ? styles.rowChecked : ""}`}
  onClick={() => startCustomer(c)}
  type="button"
>

                          <div>
                            <div className={styles.rowTitle}>{safeName(c)}</div>
                            {metaLine ? <div className={styles.rowMeta}>{metaLine}</div> : null}
                          </div>
                          <div className={styles.rowRight}>
                           {openVisit ? <div className={styles.badgeChecked}>Bearbeiten</div> : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </>
          ) : null}

     {/* GUEST */}
{!isKioskOpen && mode === "guest" ? (
  <>
    <div className={styles.note}>Gast starten – Nummer wird automatisch vergeben.</div>

    <div className={styles.footerRow}>
      <button className={styles.primary} type="button" onClick={startGuest}>
        Gast starten
      </button>
    </div>

    <div className={styles.list} style={{ marginTop: 12 }}>
      {todayGuestVisits.length === 0 ? (
        <div className={styles.emptyInline}>Heute noch keine Gäste eingecheckt.</div>
      ) : (
        todayGuestVisits.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`${styles.row} ${styles.rowActive}`}
            onClick={() => editGuestVisit(v)}
          >
            <div>
              <div className={styles.rowTitle}>{String(v.displayName || "Gast")}</div>
              <div className={styles.rowMeta}>Bearbeiten</div>
            </div>
            <div className={styles.rowRight}>
              <div className={styles.badgeChecked}>Bearbeiten</div>
            </div>
          </button>
        ))
      )}
    </div>
  </>
) : null}


          {/* GROUP */}
          {!isKioskOpen && mode === "group" ? (
            <>
              {!selectedGroup ? (
                <>
                  <div className={styles.searchRow}>
                    <input
                      className={styles.search}
                      value={groupQuery}
                      onChange={(e) => setGroupQuery(e.target.value)}
                      placeholder="Gruppe suchen… (Name / Tel / E-Mail)"
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                  </div>

                  {grpSearch.length === 0 ? (
                    <div className={styles.note}>Gruppenname, Telefonnummer oder E-Mail eingeben.</div>
                  ) : (
                    <div className={styles.list}>
                      {filteredGroups.length === 0 ? (
                        <div className={styles.emptyInline}>Kein Treffer.</div>
                      ) : (
                        filteredGroups.map((g) => {
                          const gid = String(g.id);
                          const hasOpenGroupVisit = !!openVisitsByGroupId.get(gid);
                          const phoneLine = showGroupPhone && g.phone ? `Tel: ${g.phone}` : "";
                          const email = g.email || g?.group?.email || "";
                          const emailLine = showGroupEmail && email ? String(email) : "";
                          const metaLine = phoneLine || emailLine;

                         const memberCount = Array.isArray(g?.members) ? g.members.length : 0;

                          return (
                            <button
                              key={g.id}
                              type="button"
                              className={styles.row}
                              onClick={() => {
                                setSelectedGroupId(String(g.id));
                                setSelectedParticipantKey("");
                                resetStep2();
                              }}
                            >
                              <div>
                                <div className={styles.rowTitle}>{groupTitle(g)}</div>
                                <div className={styles.rowMeta}>{metaLine ? metaLine : `${memberCount} Mitglied${memberCount === 1 ? "" : "er"}`}</div>
                              </div>
                              <div className={styles.rowRight}>
                                {hasOpenGroupVisit ? (
                                   <div className={styles.badgeChecked}>Bearbeiten</div>
                                  ) : (
                                 <div className={styles.badge}>Auswählen</div>
                                )}

                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.groupHeader}>
                    <div>
                      <div className={styles.groupHeaderTitle}>{groupTitle(selectedGroup)}</div>
                      <div className={styles.groupHeaderSub}>
                        Fortschritt: <b>{doneCount}/{participants.length}</b>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => {
                        setSelectedGroupId("");
                        setSelectedParticipantKey("");
                        setDoneMap({});
                        resetStep2();
                      }}
                    >
                      Gruppe wechseln
                    </button>
                  </div>

                  <div className={styles.participantList}>
                    {participants.map((p) => {
                      const gid = String(selectedGroup.id);
                      const keyByParticipant = `${gid}||${String(p.key)}`;
                      const key = `${String(selectedGroup.id)}||${String(p.key)}`;
                      const openVisit = findOpenVisitForParticipant(gid, p);
                      const isOpen = !!openVisit;
                      const isDone = isOpen || !!doneMap[p.key];
                      const tel = onlyDigits(p.phone).length ? `Tel: ${p.phone}` : "";

                      return (
                        <button
                          key={p.key}
                          type="button"
                           className={`${styles.row} ${isOpen ? styles.rowChecked : ""}`}
                          onClick={() => startGroupParticipant(p)}
                        >
                         <div>
                          <div className={styles.rowTitle}>
                             {p.displayName} <span className={styles.chip}>{p.tag}</span>
                          </div>
                         {tel ? <div className={styles.rowMeta}>{tel}</div> : null}
                         </div>

                         <div className={styles.rowRight}>
                         {isOpen ? (
                         <div className={styles.badgeChecked}>Bearbeiten</div>
                          ) : (
                         <div className={styles.badge}>Buchen</div>
                          )}
                        </div>

                     </button>
                      );
                    })}
                  </div>

                  {allDone ? (
                    <div className={styles.note} style={{ marginTop: 12 }}>
                      Gruppe komplett – du kannst eine neue Gruppe auswählen.
                    </div>
                  ) : (
                    null
                  )}
                </>
              )}
            </>
          ) : null}
        </div>

        {/* Overlay: Check-ins heute */}
        {openToday ? (
          <div className={styles.overlay} role="dialog" aria-modal="true">
            <div className={styles.overlayCard}>
              <div className={styles.overlayHead}>
                <div>
                  <div className={styles.overlayTitle}>Check-ins heute</div>
                  <div className={styles.overlaySub}>Suche findet auch Gruppen-Mitglieder.</div>
                </div>
                <button className={styles.back} type="button" onClick={resetTodayModal}>
                  Schließen
                </button>
              </div>

              <div className={styles.overlayBody}>
                {/* LEFT */}
                <div className={styles.overlayLeft}>
                  <div className={styles.searchRow} style={{ marginBottom: 10 }}>
                    <input
                      className={styles.search}
                      value={todayQuery}
                      onChange={(e) => setTodayQuery(e.target.value)}
                      placeholder="Suche: Name / Tel / E-Mail"
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                  </div>

                  <div className={styles.treeList}>
                    {todayLeftTree.length === 0 ? (
                      <div className={styles.emptyInline}>
                        {todayQuery.trim() ? "Kein Treffer." : "Noch keine Check-ins."}
                      </div>
                    ) : (
                      todayLeftTree.map((node) => {
                        const isOn = todaySelectedVisitId === node.visitId && !todaySelectedMemberId;
                        const isGroup = node.kind === "group";

                        return (
                          <div key={node.visitId} className={styles.treeNode}>
                            <button
                              type="button"
                              className={`${styles.row} ${isOn ? styles.rowOn : ""}`}
                              onClick={() => {
                                setTodaySelectedMemberId("");
                                openTodayDetails(node.visitId, "");
                              }}
                            >
                              <div>
                                <div className={styles.rowTitle}>{node.title}</div>
                                {node.meta ? <div className={styles.rowMeta}>{node.meta}</div> : null}
                              </div>
                            </button>

                            {isGroup && Array.isArray(node.membersInline) && node.membersInline.length > 0 ? (
                              <div className={styles.memberInline}>
                                {node.membersInline.map((m) => {
                                  const on = todaySelectedVisitId === node.visitId && String(todaySelectedMemberId) === String(m.id);
                                  const phone = String(m.phone || "").trim();
                                  return (
                                    <button
                                      key={m.id}
                                      type="button"
                                      className={`${styles.row} ${styles.memberRow} ${on ? styles.rowOn : ""}`}
                                      onClick={() => {
                                        setTodaySelectedMemberId(String(m.id));
                                        openTodayDetails(node.visitId, String(m.id));
                                      }}
                                    >
                                      <div>
                                        <div className={styles.rowTitle}>{m.displayName}</div>
                                        {phone ? <div className={styles.rowMeta}>Tel: {phone}</div> : null}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* RIGHT */}
                <div className={styles.overlayRight}>
                  {!todaySelectedVisitId ? (
                    <div className={styles.emptyInline}>Links auswählen.</div>
                  ) : !selectedVisitFull ? (
                    <div className={styles.emptyInline}>Details werden geladen…</div>
                  ) : (
                    <div className={styles.detailCard}>
                      {/* Tabs: Produkte only if exists; Notizen only if exists */}
                      <div className={styles.browserTabs}>
                        <button
                          type="button"
                          className={`${styles.browserTab} ${detailTab === "info" ? styles.browserTabOn : ""}`}
                          onClick={() => setDetailTab("info")}
                        >
                          Kundendaten
                        </button>
                        <button
                          type="button"
                          className={`${styles.browserTab} ${detailTab === "order" ? styles.browserTabOn : ""}`}
                          onClick={() => setDetailTab("order")}
                        >
                          Behandlung
                        </button>

                        {shownProducts.length > 0 ? (
                          <button
                            type="button"
                            className={`${styles.browserTab} ${detailTab === "products" ? styles.browserTabOn : ""}`}
                            onClick={() => setDetailTab("products")}
                          >
                            Produkte
                          </button>
                        ) : null}

                       {notesBlock.hasVisitNote || notesBlock.has || notesByMember.length > 0 ? (
                          <button
                            type="button"
                            className={`${styles.browserTab} ${detailTab === "notes" ? styles.browserTabOn : ""}`}
                            onClick={() => setDetailTab("notes")}
                          >
                            Notizen
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className={`${styles.browserTab} ${detailTab === "status" ? styles.browserTabOn : ""}`}
                          onClick={() => setDetailTab("status")}
                        >
                          Status
                        </button>
                      </div>

                      <div className={styles.browserPanel}>
                        {/* INFO */}
                        {detailTab === "info" ? (
                          <>
                            <div className={styles.detailTitle}>
                              {selectedVisitFull.isGroup ? (activeMember ? "Gruppen-Mitglied" : "Gruppe") : "Kunde"}
                            </div>

                            <div className={styles.detailList}>
                              <div className={styles.detailRow}>
                                <div className={styles.detailName}>Name</div>
                                <div className={styles.detailPrice}>{infoName}</div>
                              </div>

                              <div className={styles.detailRow}>
                                <div className={styles.detailName}>Telefon</div>
                                <div className={styles.detailPrice}>{infoPhone}</div>
                              </div>

                              <div className={styles.detailRow}>
                                <div className={styles.detailName}>Check-in</div>
                                <div className={styles.detailPrice}>{infoCheckIn}</div>
                              </div>

                              <div className={styles.detailRow}>
                                <div className={styles.detailName}>Letzter Besuch</div>
                                <div className={styles.detailPrice}>{infoLastVisit}</div>
                              </div>
                            </div>
                          </>
                        ) : null}

                        {/* ORDER */}
                        {detailTab === "order" ? (
                          <>
                            <div className={styles.detailTitle}>Behandlungen</div>

                            {shownServices.length === 0 ? (
                              <div className={styles.detailMuted}>Keine Behandlungen.</div>
                            ) : isGroupOverview ? (
                              <div className={styles.groupBlocks}>
                                {(selectedVisitFull.members || []).map((m) => {
                                  const lines = (selectedVisitFull.serviceLines || []).filter(
                                    (s) => String(s.memberId || "") === String(m.id)
                                  );
                                  if (lines.length === 0) return null;

                                  return (
                                    <div key={m.id} className={styles.groupBlock}>
                                      <div className={styles.groupBlockHead}>
                                        <div className={styles.groupBlockTitle}>{m.displayName}</div>
                                        <div className={styles.groupBlockMeta}>
                                          {lines.length} Behandlung{lines.length === 1 ? "" : "en"}
                                        </div>
                                      </div>

                                    <div className={`${styles.detailList} ${styles.orderList}`}>
  {lines.map((s) => (
    <div key={s.id} className={styles.detailRow}>
      <div className={styles.detailName}>
        <div className={styles.lineTitle}>{s.title}</div>
        <div className={styles.lineMeta}>{staffLineForService(selectedVisitFull, s)}</div>
      </div>
      <div className={styles.detailPrice} />
    </div>
  ))}
</div>

                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                             <div className={`${styles.detailList} ${styles.orderList}`}>
  {shownServices.map((s) => (
    <div key={s.id} className={styles.detailRow}>
      <div className={styles.detailName}>
        <div className={styles.lineTitle}>{s.title}</div>
        <div className={styles.lineMeta}>{staffLineForService(selectedVisitFull, s)}</div>
      </div>
      <div className={styles.detailPrice} />
    </div>
  ))}
</div>

                            )}
                          </>
                        ) : null}

                        {/* PRODUCTS */}
                        {detailTab === "products" ? (
                          <>
                            <div className={styles.detailTitle}>Produkte</div>
                            <div className={styles.detailList}>
                              {shownProducts.map((p) => (
                                <div key={p.id} className={styles.detailRow}>
                                  <div className={styles.detailName}>
                                    <div className={styles.lineTitle}>
                                      {p.title} <span className={styles.detailQty}>x{p.qty}</span>
                                    </div>
                                    <div className={styles.lineMeta}>
                                      {preferText(p.staffName) ? `Mitarbeiter: ${preferText(p.staffName)}` : "—"}
                                    </div>
                                  </div>
                                  <div className={styles.detailPrice} />
                                </div>
                              ))}
                            </div>
                          </>
                        ) : null}

                        {/* NOTES */}
                        {detailTab === "notes" ? (
                          <>
                            <div className={styles.detailTitle}>Notizen</div>

                            {/* visit-level note once */}
                            {preferText(selectedVisitFull?.visit?.note) ? (
                              <pre className={styles.notesBox}>{`• ${preferText(selectedVisitFull.visit.note)}`}</pre>
                            ) : null}

                            {isGroupOverview ? (
                              notesByMember.length === 0 ? (
                                <div className={styles.detailMuted}>Keine Notizen.</div>
                              ) : (
                                <div className={styles.groupBlocks}>
                                  {notesByMember.map((b) => (
                                    <div key={b.memberId} className={styles.groupBlock}>
                                      <div className={styles.groupBlockHead}>
                                        <div className={styles.groupBlockTitle}>{b.name}</div>
                                        <div className={styles.groupBlockMeta}>Notizen</div>
                                      </div>
                                      <pre className={styles.notesBox}>{b.text}</pre>
                                    </div>
                                  ))}
                                </div>
                              )
                           ) : (
                                 <>
                                   {notesBlock.has ? (
                                       <pre className={styles.notesBox}>{notesBlock.text}</pre>
                                          ) : notesBlock.hasVisitNote ? null : (
                                        <div className={styles.detailMuted}>Keine Notizen.</div>
                                        )}
                                 </>
                               )}           
                          </>
                        ) : null}
                        

                        {/* STATUS: cards */}
                        {detailTab === "status" ? (
                          <>
                            <div className={styles.detailTitle}>Status</div>

                            {shownServices.length === 0 ? (
                              <div className={styles.detailMuted}>Keine Behandlungen.</div>
                            ) : isGroupOverview ? (
                              <div className={styles.groupBlocks}>
                                {statusByMember.map((block) => (
                                  <div key={String(block.member?.id || "")} className={styles.groupBlock}>
                                    <div className={styles.groupBlockHead}>
                                      <div className={styles.groupBlockTitle}>{block.member?.displayName || "Mitglied"}</div>
                                      <div className={styles.groupBlockMeta}>
                                        {block.rows.length} Behandlung{block.rows.length === 1 ? "" : "en"}
                                      </div>
                                    </div>

                                    <div className={styles.statusStack}>
                                      {block.rows.map((r) => {
                                        const tone =
                                          r.phase === "active"
                                            ? styles.toneActive
                                            : r.phase === "checkout"
                                            ? styles.toneCheckout
                                            : r.phase === "paid"
                                            ? styles.tonePaid
                                            : styles.toneWaiting;

                                        return (
                                          <div key={r.id} className={`${styles.statusCardRow} ${tone}`}>
                                            <div className={styles.statusLeft}>
                                              <div className={styles.statusSvcTitle}>{r.title}</div>
                                              {r.staffHint ? <div className={styles.statusSvcMeta}>{r.staffHint}</div> : null}
                                            </div>

                                            <div className={styles.statusMid}>
                                              <span className={styles.statusPill}>{r.phaseLabel}</span>
                                              <div className={styles.statusSince}>{r.sinceClock}</div>
                                            </div>

                                            <div className={styles.statusRight}>
                                              <div className={styles.statusCounter}>{r.counter}</div>
                                              <div className={styles.statusHint}>laufend</div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={styles.statusStack}>
                                {statusRows.map((r) => {
                                  const tone =
                                    r.phase === "active"
                                      ? styles.toneActive
                                      : r.phase === "checkout"
                                      ? styles.toneCheckout
                                      : r.phase === "paid"
                                      ? styles.tonePaid
                                      : styles.toneWaiting;

                                  return (
                                    <div key={r.id} className={`${styles.statusCardRow} ${tone}`}>
                                      <div className={styles.statusLeft}>
                                        <div className={styles.statusSvcTitle}>{r.title}</div>
                                        {r.staffHint ? <div className={styles.statusSvcMeta}>{r.staffHint}</div> : null}
                                      </div>

                                      <div className={styles.statusMid}>
                                        <span className={styles.statusPill}>{r.phaseLabel}</span>
                                        <div className={styles.statusSince}>{r.sinceClock}</div>
                                      </div>

                                      <div className={styles.statusRight}>
                                        <div className={styles.statusCounter}>{r.counter}</div>
                                        <div className={styles.statusHint}>laufend</div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* live refresh */}
                            <div style={{ display: "none" }}>{tick}</div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "none" }}>{tick}</div>
            </div>
          </div>
        ) : null}

        <div style={{ display: "none" }}>
          <button type="button" onClick={() => nav("/reception")}>
            back
          </button>
        </div>
      </div>
    </div>
  );
}
