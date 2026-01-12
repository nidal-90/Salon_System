// src/app/router/routeConfig.js
export const routeConfig = {
  admin: [
    { label: "Dashboard", path: "/admin" },
    { label: "Mitarbeiter", path: "/admin/staff" },
    { label: "Bereiche", path: "/admin/areas" },
    { label: "Katalog", path: "/admin/catalog" },
    { label: "Kunden", path: "/admin/customers" },
    { label: "Reports", path: "/admin/reports" },
  ],
  reception: [
    { label: "Reception", path: "/reception" },
    { label: "Check-in", path: "/reception/checkin" },
    { label: "Check-out", path: "/reception/checkout" },
    { label: "Liveboard", path: "/reception/liveboard" },
    { label: "Tagesumsatz", path: "/reception/summary" },
    { label: "Kasse", path: "/reception/pos" },
    { label: "Gutscheine", path: "/reception/vouchers" },
  ],
  staff: [
    { label: "Home", path: "/staff" },
    { label: "Mein Tag", path: "/staff/today" },
  ],
};
