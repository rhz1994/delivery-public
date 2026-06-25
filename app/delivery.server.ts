import prisma from "./db.server";

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

export type DeliveryOption = {
  deliveryLocationId: number;
  deliveryLocationName: string;
  deliveryDate: string; // YYYY-MM-DD
  packDate: string; // YYYY-MM-DD
  stopDate: string; // YYYY-MM-DD — sista beställningsdag
};

export type DeliveryAvailability = {
  zipcode: string;
  homeDelivery: DeliveryOption[]; // home_delivery = true, postnummer = kundens
  pickup: DeliveryOption[]; // zipcode IS NULL — utlämningsställen, gäller alla
};

const ZIPCODE_PATTERN = /^\d{5}$/;

// Datum lagras som @db.Date (UTC-midnatt). Formatera utan tidszons-skift.
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// "Idag" i svensk tid, som YYYY-MM-DD, för att gömma alternativ vars
// beställningsstopp redan passerat.
function stockholmToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${parts}T00:00:00.000Z`);
}

export type DeliverySummary = {
  total: number;
  upcoming: number; // stopDate >= idag
  firstDeliveryDate: string | null;
  lastDeliveryDate: string | null;
  lastImportAt: string | null; // senast skapad/uppdaterad rad (ISO)
};

// Sammanfattning för butikens admin-översikt.
export async function getDeliverySummary(shop: string): Promise<DeliverySummary> {
  const today = stockholmToday();

  const [total, upcoming, range, latest] = await Promise.all([
    prisma.deliveryWindow.count({ where: { shop } }),
    prisma.deliveryWindow.count({ where: { shop, stopDate: { gte: today } } }),
    prisma.deliveryWindow.aggregate({
      where: { shop },
      _min: { deliveryDate: true },
      _max: { deliveryDate: true },
    }),
    prisma.deliveryWindow.findFirst({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return {
    total,
    upcoming,
    firstDeliveryDate: range._min.deliveryDate
      ? toIsoDate(range._min.deliveryDate)
      : null,
    lastDeliveryDate: range._max.deliveryDate
      ? toIsoDate(range._max.deliveryDate)
      : null,
    lastImportAt: latest?.updatedAt ? latest.updatedAt.toISOString() : null,
  };
}

export async function getDeliveryAvailability(
  shop: string,
  zipcode: string,
): Promise<DeliveryAvailability> {
  if (!ZIPCODE_PATTERN.test(zipcode)) {
    throw new DeliveryError(
      "Ange ett giltigt svenskt postnummer med fem siffror.",
      400,
    );
  }

  const today = stockholmToday();

  // Hämta butikens egna leveransfönster: kundens postnummer + alla
  // NULL-postnummer (gäller alla), men bara alternativ vars sista
  // beställningsdag inte passerat.
  const rows = await prisma.deliveryWindow.findMany({
    where: {
      shop,
      OR: [{ zipcode }, { zipcode: null }],
      stopDate: { gte: today },
    },
    orderBy: [{ deliveryDate: "asc" }, { deliveryLocationName: "asc" }],
  });

  const homeDelivery: DeliveryOption[] = [];
  const pickup: DeliveryOption[] = [];

  for (const row of rows) {
    const option: DeliveryOption = {
      deliveryLocationId: row.deliveryLocationId,
      deliveryLocationName: row.deliveryLocationName,
      deliveryDate: toIsoDate(row.deliveryDate),
      packDate: toIsoDate(row.packDate),
      stopDate: toIsoDate(row.stopDate),
    };

    if (row.homeDelivery) {
      homeDelivery.push(option);
    } else {
      pickup.push(option);
    }
  }

  return { zipcode, homeDelivery, pickup };
}
