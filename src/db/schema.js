// src/db/schema.js
export const DB_NAME = "sibel_salon_system";

export const DB_VERSION = 6;

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

export const schemaV5 = {
  ...schemaV4,
 order_drafts: `
    id,
    createdAt,
    updatedAt,
    finalizedAt,
    voidedAt,
    status,
    dateKey,

    groupId,
    participantKey,
    participantRole,

    customerId,
    displayName,
    phone,
    preferredPaymentMode,

    comment,
    requestedStaffByArea,

    servicesJson,
    productsJson,

    visitId,

    [dateKey+status],
    [groupId+participantKey],
    [customerId+dateKey],
    [status+updatedAt]
  `,

  /**
   * Audit Log – jede Änderung/Storno/Finalize nachvollziehbar
   */
  order_events: `
    id,
    createdAt,
    dateKey,
    draftId,
    type,
    actorStaffId,
    actorName,
    payloadJson,
    [draftId+createdAt],
    [dateKey+type]
  `,
  visit_voids: "id, dateKey, visitId, customerId, memberId, kind, title, staffId, cashierStaffId, createdAt",
    checkout_events: `
    id,
    createdAt,
    dateKey,
    visitId,
    itemKey,
    type,
    actorStaffId,
    actorName,
    payloadJson,
    [visitId+createdAt],
    [dateKey+type],
    [visitId+type]
  `,
};

export const schemaV6 = {
  ...schemaV5,

  // --- NEW: groups (separate entity) ---
  groups: `
    id,
    createdAt,
    updatedAt,
    title,
    active,

    contactFirstName,
    contactLastName,
    phone,
    email,
    instagram,

    marketingConsent,
    address,
    note,

    paymentMode,
    [title],
    [phone],
    [email]
  `,

  // --- NEW: group members normalized ---
  group_members: `
    id,
    groupId,
    displayName,
    phone,
    customerId,
    sortOrder,
    createdAt,
    updatedAt,
    [groupId+sortOrder],
    [groupId+displayName],
    [customerId]
  `,

  // --- visits: add group linkage for robust display ---
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
    readyForCheckoutAt,

    groupId,
    participantKey,
    participantRole,

    [dateKey+status],
    [customerId+dateKey],
    [groupId+dateKey]
  `,
};
