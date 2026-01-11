import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function createVisitFromReception({ displayName, customerId = null, note = "", requestedAreas }) {
  const now = new Date();
  const dateKey = toDateKeyISO(now);

  return db.transaction("rw", db.visits, db.visit_members, db.visit_area_state, async () => {
    const visitId = uid("visit");
    const requestedAreaIds = requestedAreas.map((a) => a.areaId);
    const requestedStaffByArea = {};
    requestedAreas.forEach((a) => {
      requestedStaffByArea[a.areaId] = a.preferredStaffId || null;
    });

    await db.visits.add({
      id: visitId,
      createdAt: now.toISOString(),
      dateKey,
      status: "open",
      type: "single",
      customerId,
      displayName,
      note,
      requestedAreaIds: JSON.stringify(requestedAreaIds),
      requestedStaffByArea: JSON.stringify(requestedStaffByArea),
      preferredPaymentMode: "single",
      readyForCheckoutAt: null,
    });

    const memberId = uid("mem");
    await db.visit_members.add({
      id: memberId,
      visitId,
      role: "primary",
      customerId,
      displayName,
      phone: "",
      createdAt: now.toISOString(),
    });

    for (const a of requestedAreas) {
      await db.visit_area_state.add({
        id: uid("vas"),
        visitId,
        areaId: a.areaId,
        dateKey,
        status: "waiting",
        preferredStaffId: a.preferredStaffId || null,
        preferredStaffName: a.preferredStaffName || null,
        assignedStaffId: null,
        assignedStaffName: null,
        startedAt: null,
        endedAt: null,
        note: a.note || "",
      });
    }

    return { visitId };
  });
}
