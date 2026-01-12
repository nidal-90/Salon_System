// src/db/index.js
import Dexie from "dexie";
import { DB_NAME, DB_VERSION, schemaV2, schemaV3 } from "./schema.js";
import { upgradeToV2, upgradeToV3 } from "./migrations.js";
import { seedIfEmpty } from "./seeds.js";

export const db = new Dexie(DB_NAME);

// v1 minimal (nur damit Upgrade nicht crasht, falls v1 schon existierte)
db.version(1).stores({
  areas: "id, code, name, active, sortOrder",
  staff: "id, name, active, role, usbKeyId, areaIds",
});

// v2 aktuelles Schema + Upgrade
db.version(2).stores(schemaV2).upgrade(async (tx) => {
  await upgradeToV2(tx);
});

// v3: vouchers hinzugefügt + Upgrade
db.version(DB_VERSION).stores(schemaV3).upgrade(async (tx) => {
  await upgradeToV3(tx);
});

export async function openDb() {
  if (!db.isOpen()) await db.open();
  return db;
}

/**
 * initDb: zentraler Einstieg für AppProviders
 * - öffnet DB
 * - seedet Mindest-Daten, wenn leer
 */
export async function initDb() {
  await openDb();
  await seedIfEmpty();
  return db;
}
