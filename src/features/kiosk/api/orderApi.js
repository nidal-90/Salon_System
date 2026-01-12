// src/features/kiosk/api/orderApi.js
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

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

  const displayName = profile?.displayName || "Kunde";
  const requestedAreaIds = Array.from(new Set(selectedServices.map((s) => s.areaId)));

  // group optional
  const members = profile?.group?.members || null;
  const paymentMode = profile?.group?.paymentMode || "single";

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
      // 1) Bestehender Kunde? Dann übernehmen:
      let customerId = profile?.customerId ? String(profile.customerId) : null;

      // 2) Neuer Kunde nur wenn explizit Profil/Wedding und KEIN customerId
      if (!customerId && (profile?.mode === "profile" || profile?.mode === "wedding")) {
        customerId = uid("cust");
        const [firstName, ...rest] = String(profile?.customer?.fullName || "").trim().split(" ");
        const lastName = rest.join(" ");

        await db.customers.add({
          id: customerId,
          createdAt,
          updatedAt: createdAt,
          firstName: firstName || profile?.customer?.fullName || "",
          lastName: lastName || "",
          phone: profile?.customer?.phone || "",
          email: profile?.customer?.email || "",
          instagram: profile?.customer?.instagram || "",
          marketingConsent: 0,
          lastVisitAt: createdAt,
          lastServedByStaffId: null,
          lastServedByStaffName: null,
        });
      }

      const visitId = uid("visit");

      await db.visits.add({
        id: visitId,
        createdAt,
        dateKey,
        status: "open",
        type: members?.length ? "group" : "single",
        customerId, // <- wichtig: bestehender Kunde wird jetzt korrekt gespeichert
        displayName,
        note: comment || "",
        requestedAreaIds: JSON.stringify(requestedAreaIds),
        requestedStaffByArea: JSON.stringify(preferredStaffByArea || {}),
        preferredPaymentMode: paymentMode,
        readyForCheckoutAt: null,
      });

      // members
      const visitMemberIds = [];
      if (members && members.length) {
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          const id = uid("mem");
          visitMemberIds.push(id);
          await db.visit_members.add({
            id,
            visitId,
            role: i === 0 ? "primary" : "member",
            customerId: m.customerId ? String(m.customerId) : null,
            displayName: String(m.displayName || "").trim() || "Mitglied",
            phone: String(m.phone || ""),
            createdAt,
          });
        }
      } else {
        const id = uid("mem");
        visitMemberIds.push(id);
        await db.visit_members.add({
          id,
          visitId,
          role: "primary",
          customerId,
          displayName,
          phone: profile?.customer?.phone || profile?.phone || "",
          createdAt,
        });
      }

      // waiting states (Schema V2: startedAt/endedAt vorhanden)
      for (const areaId of requestedAreaIds) {
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
          startedAt: createdAt, // -> “waiting started”
          endedAt: null,
          note: "",
        });
      }

      // services
      for (const s of selectedServices) {
        await db.visit_services.add({
          id: uid("vs"),
          visitId,
          memberId: visitMemberIds[0],
          areaId: s.areaId,
          staffId: null,
          staffName: null,
          title: s.title,
          price: Number(s.price || 0),
          startedAt: null,
          endedAt: null,
          dateKey,
          note: "",
        });
      }

      // products
      for (const p of cart || []) {
        await db.visit_products.add({
          id: uid("vp"),
          visitId,
          memberId: visitMemberIds[0],
          staffId: null,
          staffName: null,
          title: p.title,
          price: Number(p.price || 0),
          qty: Number(p.qty || 1),
          dateKey,
        });
      }

      // history (nur wenn customerId existiert)
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
            services: selectedServices.map((x) => ({
              title: x.title,
              areaId: x.areaId,
              price: x.price,
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
