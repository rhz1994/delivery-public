import prisma from "./db.server";

// CSV-import av leveransfönster för en specifik butik (admin-uppladdning).
// CSV-kolumner (header krävs):
//   delivery_date,pack_date,home_delivery,delivery_location_id,stop_date,zipcode,delivery_location_name
// zipcode = "NULL" eller tomt tolkas som null (gäller alla postnummer).
//
// Importen ersätter butikens kommande fönster (replace_upcoming från idag):
// alla rader med deliveryDate >= idag tas bort och ersätts med CSV:ns innehåll.

const EXPECTED_HEADER = [
  "delivery_date",
  "pack_date",
  "home_delivery",
  "delivery_location_id",
  "stop_date",
  "zipcode",
  "delivery_location_name",
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZIPCODE_PATTERN = /^\d{5}$/;
const MAX_ROWS = 50000;

export type CsvImportResult =
  | { ok: true; deleted: number; created: number }
  | { ok: false; errors: string[] };

function parseLine(line: string): string[] {
  const fields: string[] = [];
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

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function stockholmToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return toDate(parts);
}

function validDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;
  const date = toDate(value);
  if (Number.isNaN(date.getTime()) || dateToIso(date) !== value) return null;
  return date;
}

export async function importDeliveryWindowsCsv(
  shop: string,
  csv: string,
): Promise<CsvImportResult> {
  const errors: string[] = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { ok: false, errors: ["Filen är tom."] };
  }

  const header = parseLine(lines[0]).map((h) => h.trim());
  if (
    header.length !== EXPECTED_HEADER.length ||
    !EXPECTED_HEADER.every((col, i) => header[i] === col)
  ) {
    return {
      ok: false,
      errors: [
        `Felaktig header. Förväntad: ${EXPECTED_HEADER.join(",")}`,
      ],
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_ROWS) {
    return {
      ok: false,
      errors: [`Filen har för många rader (max ${MAX_ROWS}).`],
    };
  }

  type Row = {
    shop: string;
    zipcode: string | null;
    deliveryDate: Date;
    packDate: Date;
    stopDate: Date;
    homeDelivery: boolean;
    deliveryLocationId: number;
    deliveryLocationName: string;
  };

  const rows: Row[] = [];
  const seen = new Set<string>();

  dataLines.forEach((line, idx) => {
    const rowNo = idx + 2; // 1-baserad + header
    const f = parseLine(line);
    if (f.length !== EXPECTED_HEADER.length) {
      errors.push(`Rad ${rowNo}: förväntade ${EXPECTED_HEADER.length} fält, fick ${f.length}.`);
      return;
    }

    const [
      deliveryDateRaw,
      packDateRaw,
      homeDeliveryRaw,
      deliveryLocationIdRaw,
      stopDateRaw,
      zipcodeRaw,
      deliveryLocationNameRaw,
    ] = f.map((v) => v.trim());

    const deliveryDate = validDate(deliveryDateRaw);
    const packDate = validDate(packDateRaw);
    const stopDate = validDate(stopDateRaw);
    if (!deliveryDate) errors.push(`Rad ${rowNo}: ogiltigt delivery_date.`);
    if (!packDate) errors.push(`Rad ${rowNo}: ogiltigt pack_date.`);
    if (!stopDate) errors.push(`Rad ${rowNo}: ogiltigt stop_date.`);

    let zipcode: string | null = null;
    if (zipcodeRaw && zipcodeRaw !== "NULL") {
      const z = zipcodeRaw.replace(/\s/g, "");
      if (!ZIPCODE_PATTERN.test(z)) {
        errors.push(`Rad ${rowNo}: zipcode måste vara fem siffror, tomt eller NULL.`);
      } else {
        zipcode = z;
      }
    }

    if (homeDeliveryRaw !== "0" && homeDeliveryRaw !== "1") {
      errors.push(`Rad ${rowNo}: home_delivery måste vara 0 eller 1.`);
    }

    const locationId = Number(deliveryLocationIdRaw);
    if (!Number.isInteger(locationId) || locationId <= 0) {
      errors.push(`Rad ${rowNo}: delivery_location_id måste vara ett positivt heltal.`);
    }

    if (!deliveryLocationNameRaw || deliveryLocationNameRaw.length > 255) {
      errors.push(`Rad ${rowNo}: delivery_location_name saknas eller är för långt.`);
    }

    if (deliveryDate && packDate && packDate > deliveryDate) {
      errors.push(`Rad ${rowNo}: pack_date måste vara samma dag eller före delivery_date.`);
    }
    if (deliveryDate && stopDate && stopDate > deliveryDate) {
      errors.push(`Rad ${rowNo}: stop_date måste vara samma dag eller före delivery_date.`);
    }

    if (
      deliveryDate &&
      packDate &&
      stopDate &&
      (homeDeliveryRaw === "0" || homeDeliveryRaw === "1") &&
      Number.isInteger(locationId) &&
      locationId > 0 &&
      deliveryLocationNameRaw &&
      deliveryLocationNameRaw.length <= 255
    ) {
      const key = `${zipcode ?? "NULL"}|${dateToIso(deliveryDate)}|${locationId}`;
      if (seen.has(key)) {
        errors.push(`Rad ${rowNo}: dubblett (samma zipcode, delivery_date, delivery_location_id).`);
      }
      seen.add(key);

      rows.push({
        shop,
        zipcode,
        deliveryDate,
        packDate,
        stopDate,
        homeDelivery: homeDeliveryRaw === "1",
        deliveryLocationId: locationId,
        deliveryLocationName: deliveryLocationNameRaw,
      });
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors: errors.slice(0, 50) };
  }
  if (rows.length === 0) {
    return { ok: false, errors: ["Inga giltiga rader att importera."] };
  }

  const replaceFromDate = stockholmToday();
  const result = await prisma.$transaction(
    async (tx) => {
      const deleted = await tx.deliveryWindow.deleteMany({
        where: { shop, deliveryDate: { gte: replaceFromDate } },
      });
      const created = await tx.deliveryWindow.createMany({ data: rows });
      return { deleted: deleted.count, created: created.count };
    },
    { maxWait: 5000, timeout: 60000 },
  );

  return { ok: true, ...result };
}
