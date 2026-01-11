// src/db/schema.js
export const DB_NAME = "sibel_salon_system";
export const DB_VERSION = 2;

export const schemaV2 = {
  areas: `
    id,
    code,
    name,
    active,
    sortOrder
  `,

  staff: `
    id,
    name,
    active,
    role,
    usbKeyId,
    areaIds,
    sortOrder,
    commissionPct,
    baseSalary,
    yearlyVacationDays
  `,

  staff_events: `
    id,
    staffId,
    dateKey,
    type,
    createdAt,
    payload,
    [staffId+dateKey+type]
  `,

  customers: `
    id,
    createdAt,
    updatedAt,
    firstName,
    lastName,
    phone,
    email,
    instagram,
    marketingConsent,
    lastVisitAt,
    lastServedByStaffId,
    lastServedByStaffName
  `,

  customer_history: `
    id,
    customerId,
    createdAt,
    visitId,
    areaId,
    staffId,
    staffName,
    type,
    payload,
    [customerId+createdAt]
  `,

  product_catalog: `
    id,
    sku,
    title,
    brand,
    price,
    active,
    category,
    sortOrder
  `,

  service_catalog: `
    id,
    areaId,
    category,
    title,
    price,
    active,
    sortOrder,
    [areaId+category]
  `,

  service_categories: `
    id,
    areaId,
    title,
    active,
    sortOrder,
    [areaId+title]
  `,

  product_categories: `
    id,
    title,
    active,
    sortOrder,
    [title]
  `,

  visits: `
    id,
    createdAt,
    dateKey,
    status,
    type,
    customerId,
    displayName,
    note,
    requestedAreaIds,
    requestedStaffByArea,
    preferredPaymentMode,
    readyForCheckoutAt
  `,

  visit_members: `
    id,
    visitId,
    role,
    customerId,
    displayName,
    phone,
    createdAt,
    [visitId+role]
  `,

  visit_area_state: `
    id,
    visitId,
    areaId,
    dateKey,
    status,
    preferredStaffId,
    preferredStaffName,
    assignedStaffId,
    assignedStaffName,
    startedAt,
    endedAt,
    note,
    [visitId+areaId],
    [dateKey+areaId+status]
  `,

  visit_services: `
    id,
    visitId,
    memberId,
    areaId,
    staffId,
    staffName,
    title,
    price,
    startedAt,
    endedAt,
    dateKey,
    note,
    [staffId+dateKey],
    [visitId+areaId],
    [visitId+memberId]
  `,

  visit_products: `
    id,
    visitId,
    memberId,
    staffId,
    staffName,
    title,
    price,
    qty,
    dateKey,
    [staffId+dateKey],
    [visitId+memberId]
  `,

  payments_today: `
    id,
    visitId,
    memberId,
    dateKey,
    method,
    amount,
    createdAt,
    cashierStaffId,
    cashierName,
    exportedAt,
    [dateKey+method],
    [visitId+memberId]
  `,

  daily_counters: `
    dateKey,
    guestNextNumber
  `,

  absences: `
    id,
    staffId,
    dateKey,
    type,
    createdAt,
    [staffId+dateKey]
  `,

  advances: `
    id,
    staffId,
    dateKey,
    timestamp,
    amount,
    note,
    [staffId+dateKey]
  `,

  manual_sales: `
    id,
    monthKey,
    dateKey,
    staffId,
    amount,
    note,
    [monthKey+staffId],
    [staffId+dateKey]
  `,
};
