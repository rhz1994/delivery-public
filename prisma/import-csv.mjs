// Importerar delivery_data.csv till DeliveryWindow-tabellen.
// Kör från gordon-delivery-widget/:  node prisma/import-csv.mjs
//
// CSV-kolumner: delivery_date,pack_date,home_delivery,delivery_location_id,stop_date,zipcode,delivery_location_name
// zipcode = "NULL" tolkas som null (= gäller alla postnummer, t.ex. utlämningsställen).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../../delivery_data.csv");
const BATCH_SIZE = 5000;

// Minimal CSV-radparser: respekterar dubbelcitat så komma inne i fält
// (t.ex. "ICA Supermarket Möllevången, Malmö") inte delar raden fel.
function parseLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function toDate(value) {
  // CSV har rena datum (YYYY-MM-DD). UTC-midnatt undviker tidszons-skift.
  return new Date(`${value}T00:00:00.000Z`);
}

async function main() {
  console.log(`Läser ${CSV_PATH} ...`);
  const raw = readFileSync(CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.shift();
  console.log(`Header: ${header}`);
  console.log(`Datarader: ${lines.length}`);

  const rows = [];
  let skipped = 0;
  for (const line of lines) {
    const f = parseLine(line);
    if (f.length !== 7) {
      skipped++;
      continue;
    }
    const [
      deliveryDate,
      packDate,
      homeDelivery,
      deliveryLocationId,
      stopDate,
      zipcode,
      deliveryLocationName,
    ] = f;

    rows.push({
      deliveryDate: toDate(deliveryDate),
      packDate: toDate(packDate),
      stopDate: toDate(stopDate),
      homeDelivery: homeDelivery === "1",
      deliveryLocationId: Number(deliveryLocationId),
      zipcode: zipcode === "NULL" || zipcode === "" ? null : zipcode,
      deliveryLocationName,
    });
  }

  if (skipped > 0) {
    console.log(`⚠️  Hoppade över ${skipped} rader med oväntat antal fält.`);
  }

  console.log("Tömmer befintlig DeliveryWindow-tabell ...");
  await prisma.deliveryWindow.deleteMany();

  console.log(`Importerar ${rows.length} rader i batchar om ${BATCH_SIZE} ...`);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await prisma.deliveryWindow.createMany({ data: batch });
    inserted += result.count;
    console.log(`  ${inserted}/${rows.length}`);
  }

  console.log(`✅ Klart. ${inserted} rader importerade.`);
}

main()
  .catch((err) => {
    console.error("❌ Import misslyckades:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
