import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";

function uid(prefix="id"){ return `${prefix}_${crypto.randomUUID()}`; }

export async function createVisitFromOrder({ profile, comment, selectedServices, preferredStaffByArea, cart }) {
  const now = new Date();
  const dateKey = toDateKeyISO(now);
  const createdAt = now.toISOString();

  const displayName = profile.displayName;
  const requestedAreaIds = Array.from(new Set(selectedServices.map(s => s.areaId)));

  // members: wedding/group optional
  const members = profile.group?.members || null;
  const paymentMode = profile.group?.paymentMode || "single";

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
      // Customer speichern nur wenn Profil oder Hochzeit-Kontakt (guest nicht)
      let customerId = null;
      if (profile.mode === "profile" || profile.mode === "wedding") {
        customerId = uid("cust");
        const [firstName, ...rest] = (profile.customer?.fullName || "").split(" ");
        const lastName = rest.join(" ");

        await db.customers.add({
          id: customerId,
          createdAt,
          updatedAt: createdAt,
          firstName: firstName || profile.customer?.fullName || "",
          lastName: lastName || "",
          phone: profile.customer?.phone || "",
          email: profile.customer?.email || "",
          instagram: profile.customer?.instagram || "",
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
        type: members ? "group" : "single",
        customerId,
        displayName,
        note: comment || "",
        requestedAreaIds: JSON.stringify(requestedAreaIds),
        requestedStaffByArea: JSON.stringify(preferredStaffByArea || {}),
        preferredPaymentMode: paymentMode,
        readyForCheckoutAt: null,
      });

      // visit members (für split payment später)
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
            customerId: null,
            displayName: m.displayName,
            phone: m.phone || "",
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
          phone: profile.customer?.phone || "",
          createdAt,
        });
      }

      // visit_area_state: waiting startet SOFORT (Timer Start)
      for (const areaId of requestedAreaIds) {
        const preferredStaffId = preferredStaffByArea?.[areaId] || null;
        const preferredStaffName = null; // Step-2: auflösen per staff table

        await db.visit_area_state.add({
          id: uid("vas"),
          visitId,
          areaId,
          dateKey,
          status: "waiting",
          preferredStaffId,
          preferredStaffName,
          assignedStaffId: null,
          assignedStaffName: null,
          waitingStartedAt: createdAt,
          waitingEndedAt: null,
          activeStartedAt: null,
          activeEndedAt: null,
          note: "",
        });
      }

      // visit_services: gewünschte Services speichern (noch ohne staff)
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
      for (const p of (cart || [])) {
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

      // history event (optional)
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
            services: selectedServices.map(x => ({ title: x.title, areaId: x.areaId, price: x.price })),
            comment: comment || "",
          }),
        });
      }

      return { visitId };
    }
  );
}
