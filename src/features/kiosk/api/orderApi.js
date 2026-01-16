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
  // Check if already exists (unique [visitId+areaId])
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
    startedAt: createdAt, // waiting started
    endedAt: null,
    note: "",
  });
}

async function upsertVisitRequestedAreas({ visitId, nextAreaIds }) {
  const row = await db.visits.get(visitId);
  if (!row) return;

  const cur = safeJsonParse(row.requestedAreaIds, []);
  const merged = uniq([...(cur || []), ...(nextAreaIds || [])]);

  await db.visits.update(visitId, {
    requestedAreaIds: JSON.stringify(merged),
  });
}

async function mergeRequestedStaffByArea({ visitId, preferredStaffByArea }) {
  const row = await db.visits.get(visitId);
  if (!row) return;

  const cur = safeJsonParse(row.requestedStaffByArea, {});
  const merged = { ...(cur || {}) };

  // only set if provided (do not wipe existing)
  for (const k of Object.keys(preferredStaffByArea || {})) {
    const v = preferredStaffByArea?.[k];
    if (v != null && String(v) !== "") merged[k] = v;
  }

  await db.visits.update(visitId, {
    requestedStaffByArea: JSON.stringify(merged),
  });
}

async function ensureVisitMember({ visitId, participantKey, customerId, displayName, phone, createdAt }) {
  // We use role = participantKey to satisfy unique [visitId+role] constraint
  const role = safeStr(participantKey) || "primary";

  const existing = await db.visit_members.where("[visitId+role]").equals([visitId, role]).first();
  if (existing) return existing.id;

  const id = uid("mem");
  await db.visit_members.add({
    id,
    visitId,
    role, // IMPORTANT: unique per participant
    customerId: customerId ? String(customerId) : null,
    displayName: safeStr(displayName) || "Mitglied",
    phone: safeStr(phone),
    createdAt,
  });

  return id;
}

/**
 * createVisitFromOrder
 * - Single customer/guest: creates new visit each time (as before)
 * - Group participant booking: reuses ONE group visit per day (customerId = groupId)
 *   and writes services/products to the correct memberId (participantKey)
 *
 * Required for group-aware booking:
 * profile.meta = {
 *   groupId: string,
 *   participantKey: string, // unique key for this participant
 *   groupDisplayName?: string, // name of the group visit
 *   paymentMode?: "single"|"split"
 * }
 */
export async function createVisitFromOrder({
  profile,
  comment,
  selectedServices,
  preferredStaffByArea,
  cart,
}) {
  const now = new Date();
  const dateKey = toDateKeyISO(now);
  const createdAt = now.toISOString();

  const selected = Array.isArray(selectedServices) ? selectedServices : [];
  const requestedAreaIds = uniq(selected.map((s) => s.areaId).filter(Boolean));

  const meta = profile?.meta || {};
  const isGroupParticipant = !!safeStr(meta.groupId) && !!safeStr(meta.participantKey);

  // display names
  const participantDisplayName = safeStr(profile?.displayName) || "Kunde";
  const groupDisplayName = safeStr(meta.groupDisplayName) || "Gruppe";

  // payment
  const paymentMode = safeStr(meta.paymentMode) || safeStr(profile?.group?.paymentMode) || "single";

  return db.transaction(
    "rw",
    db.customers,
    db.customer_history,
    db.visits,
    db.visit_members,
    db.visit_area_state,
    db.visit_services,
    db.visit_products,
    async () => {
      // CUSTOMER ID for history (participant)
      let customerId = profile?.customerId ? String(profile.customerId) : null;

      // Only create a new customer for explicit profile/wedding mode (as you had)
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

      // ============== GROUP FLOW (one shared visit per group) ==============
      if (isGroupParticipant) {
        const groupId = String(meta.groupId);
        const participantKey = String(meta.participantKey);

        // Find existing open group visit for today (reuse)
        let visit = await db.visits
  .where("dateKey")
  .equals(dateKey)
  .and((v) =>
    String(v.status) === "open" &&
    String(v.type) === "group" &&
    String(v.customerId || "") === String(groupId)
  )
  .first();

        let visitId = visit?.id;

        // If not found, create it
        if (!visitId) {
          visitId = uid("visit");

          await db.visits.add({
            id: visitId,
            createdAt,
            dateKey,
            status: "open",
            type: "group",
            customerId: groupId, // group owner row in customers
            displayName: groupDisplayName,
            note: "", // group level note optional (we keep participant notes per service/note)
            requestedAreaIds: JSON.stringify([]),
            requestedStaffByArea: JSON.stringify({}),
            preferredPaymentMode: paymentMode,
            readyForCheckoutAt: null,
          });

          visit = await db.visits.get(visitId);
        }

        // Merge requested areas + staff map into visit
        await upsertVisitRequestedAreas({ visitId, nextAreaIds: requestedAreaIds });
        await mergeRequestedStaffByArea({ visitId, preferredStaffByArea });

        // Ensure area waiting state exists for new areas
        for (const areaId of requestedAreaIds) {
          await ensureVisitAreaState({ visitId, dateKey, areaId, preferredStaffByArea, createdAt });
        }

        // Ensure member row (role=participantKey)
        const memberId = await ensureVisitMember({
          visitId,
          participantKey,
          customerId,
          displayName: participantDisplayName,
          phone: safeStr(profile?.customer?.phone || profile?.phone),
          createdAt,
        });

        // Write services for THIS member
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
            note: safeStr(comment || ""), // participant note at service-level, keeps context
          });
        }

        // Write products for THIS member
        for (const p of cart || []) {
          await db.visit_products.add({
            id: uid("vp"),
            visitId,
            memberId,
            staffId: null,
            staffName: null,
            title: safeStr(p.title),
            price: Number(p.price || 0),
            qty: Number(p.qty || 1),
            dateKey,
          });
        }

        // Customer history: only when participant has customerId
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
              services: selected.map((x) => ({
                title: x.title,
                areaId: x.areaId,
                price: x.price,
              })),
              products: (cart || []).map((x) => ({
                title: x.title,
                price: x.price,
                qty: x.qty,
              })),
              comment: comment || "",
            }),
          });

          await db.customers.update(customerId, {
            lastVisitAt: createdAt,
            updatedAt: createdAt,
          });
        }

        return { visitId };
      }

      // ============== SINGLE FLOW (your existing behavior) ==============
      const visitId = uid("visit");

      const displayName = participantDisplayName;

      await db.visits.add({
        id: visitId,
        createdAt,
        dateKey,
        status: "open",
        type: "single",
        customerId,
        displayName,
        note: comment || "",
        requestedAreaIds: JSON.stringify(requestedAreaIds),
        requestedStaffByArea: JSON.stringify(preferredStaffByArea || {}),
        preferredPaymentMode: paymentMode,
        readyForCheckoutAt: null,
      });

      const memberId = uid("mem");
      await db.visit_members.add({
        id: memberId,
        visitId,
        role: "primary",
        customerId,
        displayName,
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

      for (const p of cart || []) {
        await db.visit_products.add({
          id: uid("vp"),
          visitId,
          memberId,
          staffId: null,
          staffName: null,
          title: safeStr(p.title),
          price: Number(p.price || 0),
          qty: Number(p.qty || 1),
          dateKey,
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
            services: selected.map((x) => ({
              title: x.title,
              areaId: x.areaId,
              price: x.price,
            })),
            products: (cart || []).map((x) => ({
              title: x.title,
              price: x.price,
              qty: x.qty,
            })),
            comment: comment || "",
          }),
        });

        await db.customers.update(customerId, {
          lastVisitAt: createdAt,
          updatedAt: createdAt,
        });
      }

      return { visitId };
    }
  );
}
