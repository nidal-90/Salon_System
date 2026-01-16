// src/db/index.js
import Dexie from "dexie";
import { DB_NAME, DB_VERSION, schemaV2, schemaV3, schemaV4, schemaV5 } from "./schema.js";
import { upgradeToV2, upgradeToV3, upgradeToV4, upgradeToV5 } from "./migrations.js";
import { seedIfEmpty } from "./seeds.js";

export const db = new Dexie(DB_NAME);

// v1 minimal
db.version(1).stores({
  areas: "id, code, name, active, sortOrder",
  staff: "id, name, active, role, usbKeyId, areaIds",
});

// v2
db.version(2).stores(schemaV2).upgrade(async (tx) => {
  await upgradeToV2(tx);
});

// v3
db.version(3).stores(schemaV3).upgrade(async (tx) => {
  await upgradeToV3(tx);
});

db.version(5).stores(schemaV5).upgrade(async (tx) => {
  await upgradeToV5(tx);
});
// v4 (NEW)
db.version(DB_VERSION).stores(schemaV5).upgrade(async (tx) => {
  await upgradeToV5(tx);
});

export async function openDb() {
  if (!db.isOpen()) await db.open();
  return db;
}

export async function initDb() {
  await openDb();
  await seedIfEmpty();
  return db;
}
