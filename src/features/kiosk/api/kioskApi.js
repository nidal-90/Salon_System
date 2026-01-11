import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function createVisitFromKiosk(payload) {
  const now = new Date();
  const dateKey = toDateKeyISO(now);

  return db.transaction(
    "rw",
    db.customers,
    db.customer_history,
    db.visits,
    db.visit_members,
    db.visit_area_state,
    db.visit_products,
    async () => {
      let customerId = payload.customerId || null;

      // customer profile optional
      if (payload.mode === "profile" && payload.customer) {
        const cId = uid("cust");
        customerId = cId;

        await db.customers.add({
          id: cId,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          firstName: payload.customer.firstName || "",
          lastName: payload.customer.lastName || "",
          phone: payload.customer.phone || "",
          email: payload.customer.email || "",
          instagram: payload.customer.instagram || "",
          marketingConsent: payload.customer.marketingConsent ? 1 : 0,
          lastVisitAt: null,
          lastServedByStaffId: null,
          lastServedByStaffName: null,
        });
      }

      const visitId = uid("visit");
      const requestedAreaIds = payload.requestedAreas.map((a) => a.areaId);
      const requestedStaffByArea = {};
      payload.requestedAreas.forEach((a) => {
        requestedStaffByArea[a.areaId] = a.preferredStaffId || null;
      });

      await db.visits.add({
        id: visitId,
        createdAt: now.toISOString(),
        dateKey,
        status: "open", // open|ready|closed
        type: payload.members?.length ? "group" : "single",
        customerId,
        displayName: payload.displayName,
        note: payload.note || "",
        requestedAreaIds: JSON.stringify(requestedAreaIds),
        requestedStaffByArea: JSON.stringify(requestedStaffByArea),
        preferredPaymentMode: payload.preferredPaymentMode || "single",
        readyForCheckoutAt: null,
      });

      // members
      const memberIds = [];
      if (payload.members?.length) {
        for (let i = 0; i < payload.members.length; i++) {
          const m = payload.members[i];
          const memberId = uid("mem");
          memberIds.push(memberId);
          await db.visit_members.add({
            id: memberId,
            visitId,
            role: i === 0 ? "primary" : "member",
            customerId: m.customerId || null,
            displayName: m.displayName,
            phone: m.phone || "",
            createdAt: now.toISOString(),
          });
        }
      } else {
        const memberId = uid("mem");
        memberIds.push(memberId);
        await db.visit_members.add({
          id: memberId,
          visitId,
          role: "primary",
          customerId,
          displayName: payload.displayName,
          phone: payload.customer?.phone || "",
          createdAt: now.toISOString(),
        });
      }

      // create area waiting states
      for (const a of payload.requestedAreas) {
        await db.visit_area_state.add({
          id: uid("vas"),
          visitId,
          areaId: a.areaId,
          dateKey,
          status: "waiting", // waiting|active|done
          preferredStaffId: a.preferredStaffId || null,
          preferredStaffName: a.preferredStaffName || null,
          assignedStaffId: null,
          assignedStaffName: null,
          startedAt: null,
          endedAt: null,
          note: a.note || "",
        });
      }

      // products optional
      if (payload.products?.length) {
        for (const p of payload.products) {
          const memberId = memberIds[p.memberIndex ?? 0] || memberIds[0];
          await db.visit_products.add({
            id: uid("vp"),
            visitId,
            memberId,
            staffId: null,
            staffName: null,
            title: p.title,
            price: Number(p.price || 0),
            qty: Number(p.qty || 1),
            dateKey,
          });
        }
      }

      // history record for profile
      if (customerId) {
        await db.customer_history.add({
          id: uid("hist"),
          customerId,
          createdAt: now.toISOString(),
          visitId,
          areaId: null,
          staffId: null,
          staffName: null,
          type: "CHECKIN",
          payload: JSON.stringify({
            requestedAreaIds,
            note: payload.note || "",
            visitType: payload.members?.length ? "group" : "single",
          }),
        });
        await db.customers.update(customerId, { lastVisitAt: now.toISOString(), updatedAt: now.toISOString() });
      }

      return { visitId };
    }
  );
}
