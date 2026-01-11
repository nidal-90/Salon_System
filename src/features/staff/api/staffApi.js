import { db } from "../../../db/index.js";

export async function listWaiting(areaId, dateKey) {
  return db.visit_area_state
    .where("[dateKey+areaId+status]").equals([dateKey, areaId, "waiting"])
    .toArray();
}

export async function listActive(areaId, dateKey) {
  return db.visit_area_state
    .where("[dateKey+areaId+status]").equals([dateKey, areaId, "active"])
    .toArray();
}

export async function markActive({ visitAreaStateId, staffId, staffName }) {
  const now = new Date().toISOString();

  await db.visit_area_state.update(visitAreaStateId, {
    status: "active",
    assignedStaffId: staffId,
    assignedStaffName: staffName,
    waitingEndedAt: now,
    activeStartedAt: now,
  });
}

export async function markDone({ visitAreaStateId }) {
  const now = new Date().toISOString();
  await db.visit_area_state.update(visitAreaStateId, {
    status: "done",
    activeEndedAt: now,
  });
}
