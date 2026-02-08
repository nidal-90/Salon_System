// src/features/kiosk/api/orderApi.js
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}
function safeStr(x) {
  return String(x == null ? "" : x).trim();
}
function safeJsonParse(x, fallback) {
  try {
    const v = JSON.parse(String(x || ""));
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

async function ensureVisitAreaState({ visitId, dateKey, areaId, preferredStaffByArea, createdAt }) {
  const existing = await db.visit_area_state.where("[visitId+areaId]").equals([visitId, areaId]).first();
  if (existing) return;

  const preferredStaffId = preferredStaffByArea?.[areaId] || null;

  await db.visit_area_state.add({
    id: uid("vas"),
    visitId,
    areaId,
    dateKey,
    status: "waiting",
    preferredStaffId,
    preferredStaffName: null,
    assignedStaffId: null,
    assignedStaffName: null,
    startedAt: createdAt,
    endedAt: null,
    note: "",
  });
}

async function upsertVisitRequestedAreas({ visitId, nextAreaIds }) {
  const row = await db.visits.get(visitId);
  if (!row) return;

  const cur = safeJsonParse(row.requestedAreaIds, []);
  const merged = uniq([...(cur || []), ...(nextAreaIds || [])]);

  await db.visits.update(visitId, { requestedAreaIds: JSON.stringify(merged) });
}

async function mergeRequestedStaffByArea({ visitId, preferredStaffByArea }) {
  const row = await db.visits.get(visitId);
  if (!row) return;

  const cur = safeJsonParse(row.requestedStaffByArea, {});
  const merged = { ...(cur || {}) };

  for (const k of Object.keys(preferredStaffByArea || {})) {
    const v = preferredStaffByArea?.[k];
    if (v != null && String(v) !== "") merged[k] = v;
  }

  await db.visits.update(visitId, { requestedStaffByArea: JSON.stringify(merged) });
}

async function ensureVisitMember({ visitId, participantKey, customerId, displayName, phone, createdAt }) {
  const role = safeStr(participantKey) || "primary";
  const existing = await db.visit_members.where("[visitId+role]").equals([visitId, role]).first();
  if (existing) return existing.id;

  const id = uid("mem");
  await db.visit_members.add({
    id,
    visitId,
    role,
    customerId: customerId ? String(customerId) : null,
    displayName: safeStr(displayName) || "Mitglied",
    phone: safeStr(phone),
    createdAt,
  });
  return id;
}

/**
 * createVisitFromOrder
 * - Single: creates new visit
 * - Group participant: reuses ONE group visit per day
 */
export async function createVisitFromOrder({
  profile,
  comment,
  selectedServices,
  preferredStaffByArea,
  preferredStaffByProduct, // NEW
  cart,
}) {
  const now = new Date();
  const dateKey = toDateKeyISO(now);
  const createdAt = now.toISOString();

  const selected = Array.isArray(selectedServices) ? selectedServices : [];
  const requestedAreaIds = uniq(selected.map((s) => s.areaId).filter(Boolean));

  const meta = profile?.meta || {};
  const isGroupParticipant = !!safeStr(meta.groupId) && !!safeStr(meta.participantKey);

  const participantDisplayName = safeStr(profile?.displayName) || "Kunde";

  // ✅ FIX: ReceptionCheckInPage uses meta.groupTitle, old code expected meta.groupDisplayName
  const groupDisplayName = safeStr(meta.groupDisplayName || meta.groupTitle) || "Gruppe";

  const paymentMode = safeStr(meta.paymentMode) || safeStr(profile?.group?.paymentMode) || "single";

  // ===== NEW: staff lookup for product staffName =====
  const staffRows = await db.staff.toArray().catch(() => []);
  const staffNameById = (id) => {
    const sid = String(id || "");
    if (!sid) return null;
    const found = (staffRows || []).find((s) => String(s.id) === sid);
    return found?.name ? String(found.name) : null;
  };

  const staffByProduct = preferredStaffByProduct && typeof preferredStaffByProduct === "object" ? preferredStaffByProduct : {};

  return db.transaction(
    "rw",
    db.customers,
    db.customer_history,
    db.visits,
    db.visit_members,
    db.visit_area_state,
    db.visit_services,
    db.visit_products,
    db.staff, // NEW: included (safe)
    async () => {
      let customerId = profile?.customerId ? String(profile.customerId) : null;

      // Create customer for profile/wedding mode if needed (keep your behaviour)
      if (!customerId && (profile?.mode === "profile" || profile?.mode === "wedding")) {
        customerId = uid("cust");
        const full = safeStr(profile?.customer?.fullName);
        const [firstName, ...rest] = full.split(" ");
        const lastName = rest.join(" ");

        await db.customers.add({
          id: customerId,
          createdAt,
          updatedAt: createdAt,
          firstName: firstName || full || "",
          lastName: lastName || "",
          phone: safeStr(profile?.customer?.phone),
          email: safeStr(profile?.customer?.email),
          instagram: safeStr(profile?.customer?.instagram),
          marketingConsent: 0,
          lastVisitAt: createdAt,
          lastServedByStaffId: null,
          lastServedByStaffName: null,
        });
      }

      // ================= GROUP FLOW =================
      if (isGroupParticipant) {
        const groupId = String(meta.groupId);
        const participantKey = String(meta.participantKey);
        const participantRole = safeStr(meta.participantRole);

        // Find existing open group visit for today:
        // ✅ compat: accept legacy (customerId==groupId) OR new (groupId==groupId)
        let visit = await db.visits
          .where("dateKey")
          .equals(dateKey)
          .and((v) => {
            const st = String(v.status || "");
            const tp = String(v.type || "").toLowerCase();
            const gid = String(v.groupId || "");
            const cid = String(v.customerId || "");
            return st === "open" && tp === "group" && (gid === groupId || cid === groupId);
          })
          .first();

        let visitId = visit?.id;

        if (!visitId) {
          visitId = uid("visit");
          await db.visits.add({
            id: visitId,
            createdAt,
            dateKey,
            status: "open",
            type: "group",

            // ✅ keep legacy compatibility:
            customerId: groupId,

            // ✅ new normalized field:
            groupId,
            participantKey: "",
            participantRole: "",

            displayName: groupDisplayName,
            note: "",
            requestedAreaIds: JSON.stringify([]),
            requestedStaffByArea: JSON.stringify({}),
            preferredPaymentMode: paymentMode,
            readyForCheckoutAt: null,
          });

          visit = await db.visits.get(visitId);
        } else {
          // Ensure groupId filled for older records
          const needsBackfill = !String(visit?.groupId || "").trim();
          if (needsBackfill) {
            await db.visits.update(visitId, { groupId });
          }
        }

        await upsertVisitRequestedAreas({ visitId, nextAreaIds: requestedAreaIds });
        await mergeRequestedStaffByArea({ visitId, preferredStaffByArea });

        for (const areaId of requestedAreaIds) {
          await ensureVisitAreaState({ visitId, dateKey, areaId, preferredStaffByArea, createdAt });
        }

        const memberId = await ensureVisitMember({
          visitId,
          participantKey,
          customerId,
          displayName: participantDisplayName,
          phone: safeStr(profile?.customer?.phone || profile?.phone),
          createdAt,
        });

        for (const s of selected) {
          await db.visit_services.add({
            id: uid("vs"),
            visitId,
            memberId,
            areaId: s.areaId,
            staffId: null,
            staffName: null,
            title: safeStr(s.title),
            price: Number(s.price || 0),
            startedAt: null,
            endedAt: null,
            dateKey,
            note: safeStr(comment || ""),
          });
        }

        // ===== NEW: staff per product stored =====
        for (const p of cart || []) {
          const pid = String(p.id || p.productId || "");
          const staffId = String(staffByProduct?.[pid] || "");
          const staffName = staffId ? staffNameById(staffId) : null;

          await db.visit_products.add({
            id: uid("vp"),
            visitId,
            memberId,
            staffId: staffId || null,
            staffName: staffName || null,
            title: safeStr(p.title),
            price: Number(p.price || 0),
            qty: Number(p.qty || 1),
            dateKey,
            productId: pid || null, // optional but useful if your schema supports it
          });
        }

        if (customerId) {
          await db.customer_history.add({
            id: uid("hist"),
            customerId,
            createdAt,
            visitId,
            areaId: null,
            staffId: null,
            staffName: null,
            type: "CHECKIN",
            payload: JSON.stringify({
              groupId,
              participantKey,
              participantRole,
              services: selected.map((x) => ({ title: x.title, areaId: x.areaId, price: x.price })),
              products: (cart || []).map((x) => ({
                title: x.title,
                price: x.price,
                qty: x.qty,
                staffId: String(staffByProduct?.[String(x.id || x.productId || "")] || ""),
              })),
              comment: comment || "",
            }),
          });

          await db.customers.update(customerId, { lastVisitAt: createdAt, updatedAt: createdAt });
        }

        return { visitId };
      }

      // ================= SINGLE FLOW =================
      const visitId = uid("visit");

      await db.visits.add({
        id: visitId,
        createdAt,
        dateKey,
        status: "open",
        type: "single",
        customerId,
        displayName: participantDisplayName,
        note: comment || "",
        requestedAreaIds: JSON.stringify(requestedAreaIds),
        requestedStaffByArea: JSON.stringify(preferredStaffByArea || {}),
        preferredPaymentMode: paymentMode,
        readyForCheckoutAt: null,

        // v6 extra fields (harmless if unused)
        groupId: "",
        participantKey: "",
        participantRole: "",
      });

      const memberId = uid("mem");
      await db.visit_members.add({
        id: memberId,
        visitId,
        role: "primary",
        customerId,
        displayName: participantDisplayName,
        phone: safeStr(profile?.customer?.phone || profile?.phone),
        createdAt,
      });

      for (const areaId of requestedAreaIds) {
        await ensureVisitAreaState({ visitId, dateKey, areaId, preferredStaffByArea, createdAt });
      }

      for (const s of selected) {
        await db.visit_services.add({
          id: uid("vs"),
          visitId,
          memberId,
          areaId: s.areaId,
          staffId: null,
          staffName: null,
          title: safeStr(s.title),
          price: Number(s.price || 0),
          startedAt: null,
          endedAt: null,
          dateKey,
          note: "",
        });
      }

      // ===== NEW: staff per product stored =====
      for (const p of cart || []) {
        const pid = String(p.id || p.productId || "");
        const staffId = String(staffByProduct?.[pid] || "");
        const staffName = staffId ? staffNameById(staffId) : null;

        await db.visit_products.add({
          id: uid("vp"),
          visitId,
          memberId,
          staffId: staffId || null,
          staffName: staffName || null,
          title: safeStr(p.title),
          price: Number(p.price || 0),
          qty: Number(p.qty || 1),
          dateKey,
          productId: pid || null, // optional but useful if your schema supports it
        });
      }

      if (customerId) {
        await db.customer_history.add({
          id: uid("hist"),
          customerId,
          createdAt,
          visitId,
          areaId: null,
          staffId: null,
          staffName: null,
          type: "CHECKIN",
          payload: JSON.stringify({
            requestedAreaIds,
            services: selected.map((x) => ({ title: x.title, areaId: x.areaId, price: x.price })),
            products: (cart || []).map((x) => ({
              title: x.title,
              price: x.price,
              qty: x.qty,
              staffId: String(staffByProduct?.[String(x.id || x.productId || "")] || ""),
            })),
            comment: comment || "",
          }),
        });

        await db.customers.update(customerId, { lastVisitAt: createdAt, updatedAt: createdAt });
      }

      return { visitId };
    }
  );
}

