// src/db/schema.js
export const DB_NAME = "sibel_salon_system";

/**
 * v4:
 * - areas: displayNo (01/02...) für UI (DB-ID bleibt stabil als FK)
 * - product_categories: displayNo
 * - service_catalog: kein Kategorie-Workflow mehr, Name statt Titel
 * - product_catalog: categoryId (FK) statt category string, Name statt Titel
 */
export const DB_VERSION = 4;

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

export const schemaV3 = {
  ...schemaV2,
  vouchers: `
    id,
    &code,
    status,
    amount,
    currency,
    customerId,
    createdAt,
    createdByStaffId,
    createdByStaffName,
    redeemedAt,
    redeemedByStaffId,
    redeemedByStaffName,
    redeemedVisitId,
    note,
    [status+createdAt],
    [customerId+createdAt]
  `,
};

/**
 * v4: New “clean catalog” fields.
 * - areas: displayNo index
 * - product_categories: displayNo index
 * - service_catalog: name (category removed from workflow)
 * - product_catalog: categoryId (FK) + name
 */
export const schemaV4 = {
  ...schemaV3,

  areas: `
    id,
    displayNo,
    name,
    active
  `,

  product_categories: `
    id,
    displayNo,
    title,
    active
  `,

  service_catalog: `
    id,
    areaId,
    name,
    price,
    active,
    [areaId+name]
  `,

  product_catalog: `
    id,
    categoryId,
    name,
    price,
    active,
    [categoryId+name]
  `,
};
