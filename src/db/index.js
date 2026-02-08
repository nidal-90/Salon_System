// src/db/index.js
import Dexie from "dexie";
import { DB_NAME, DB_VERSION, schemaV2, schemaV3, schemaV4, schemaV5, schemaV6 } from "./schema.js";
import { upgradeToV2, upgradeToV3, upgradeToV4, upgradeToV5, upgradeToV6 } from "./migrations.js";
import { seedIfEmpty } from "./seeds.js";

export const db = new Dexie(DB_NAME);

// v1 minimal
db.version(1).stores({
  areas: "id, code, name, active, sortOrder",
  staff: "id, name, active, role, usbKeyId, areaIds",
});

// v2
db.version(2).stores(schemaV2).upgrade(upgradeToV2);

// v3
db.version(3).stores(schemaV3).upgrade(upgradeToV3);

// v4
db.version(4).stores(schemaV4).upgrade(upgradeToV4);

// v5
db.version(5).stores(schemaV5).upgrade(upgradeToV5);

// v6 (groups + group_members + visits extensions)
db.version(6).stores(schemaV6).upgrade(upgradeToV6);

export async function openDb() {
  if (!db.isOpen()) await db.open();
  return db;
}

export async function initDb() {
  await openDb();
  await seedIfEmpty();
  return db;
}
