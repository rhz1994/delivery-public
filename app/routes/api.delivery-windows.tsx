import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

type ImportMode = "upsert" | "replace_upcoming";

type DeliveryWindowImportItem = {
  zipcode: string | null;
  deliveryDate: Date;
  packDate: Date;
  stopDate: Date;
  homeDelivery: boolean;
  deliveryLocationId: number;
  deliveryLocationName: string;
};

type ValidationResult =
  | { ok: true; mode: ImportMode; replaceFromDate: Date; items: DeliveryWindowImportItem[] }
  | { ok: false; errors: string[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZIPCODE_PATTERN = /^\d{5}$/;
const MAX_ITEMS = 5000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function methodNotAllowed() {
  return json({ error: "Method not allowed. Use POST." }, 405);
}

function parseApiKey(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function hasValidApiKey(request: Request) {
  const configuredKey = process.env.EXTERNAL_DELIVERY_WINDOWS_API_KEY;
  if (!configuredKey) {
    throw new Error("EXTERNAL_DELIVERY_WINDOWS_API_KEY is not configured");
  }

  const providedKey = parseApiKey(request);
  const configured = Buffer.from(configuredKey);
  const provided = Buffer.from(providedKey);

  return configured.length === provided.length && timingSafeEqual(configured, provided);
}

function stockholmToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return toDate(parts);
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateToIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    errors.push(`${path} must be a date string in YYYY-MM-DD format.`);
    return null;
  }

  const date = toDate(value);
  if (Number.isNaN(date.getTime()) || dateToIso(date) !== value) {
    errors.push(`${path} must be a valid calendar date.`);
    return null;
  }

  return date;
}

function normalizeZipcode(value: unknown, path: string, errors: string[]) {
  if (value === null || value === undefined || value === "" || value === "NULL") {
    return null;
  }

  if (typeof value !== "string") {
    errors.push(`${path} must be a string with five digits, null, or omitted.`);
    return null;
  }

  const zipcode = value.replace(/\s/g, "").trim();
  if (!ZIPCODE_PATTERN.test(zipcode)) {
    errors.push(`${path} must contain exactly five digits.`);
    return null;
  }

  return zipcode;
}

function validatePayload(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const body = payload as Record<string, unknown>;
  const mode = body.mode === undefined ? "upsert" : body.mode;
  if (mode !== "upsert" && mode !== "replace_upcoming") {
    errors.push('mode must be either "upsert" or "replace_upcoming".');
  }

  const replaceFromDate =
    typeof body.replaceFromDate === "undefined"
      ? stockholmToday()
      : parseDate(body.replaceFromDate, "replaceFromDate", errors);

  if (!Array.isArray(body.items)) {
    errors.push("items must be an array.");
    return { ok: false, errors };
  }

  if (body.items.length === 0) {
    errors.push("items must contain at least one delivery window.");
  }

  if (body.items.length > MAX_ITEMS) {
    errors.push(`items may contain at most ${MAX_ITEMS} delivery windows per request.`);
  }

  const items: DeliveryWindowImportItem[] = [];
  const seenKeys = new Set<string>();

  body.items.forEach((rawItem, index) => {
    const path = `items[${index}]`;
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      errors.push(`${path} must be an object.`);
      return;
    }

    const item = rawItem as Record<string, unknown>;
    const zipcode = normalizeZipcode(item.zipcode, `${path}.zipcode`, errors);
    const deliveryDate = parseDate(item.deliveryDate, `${path}.deliveryDate`, errors);
    const packDate = parseDate(item.packDate, `${path}.packDate`, errors);
    const stopDate = parseDate(item.stopDate, `${path}.stopDate`, errors);

    if (typeof item.homeDelivery !== "boolean") {
      errors.push(`${path}.homeDelivery must be true or false.`);
    }

    if (
      typeof item.deliveryLocationId !== "number" ||
      !Number.isInteger(item.deliveryLocationId) ||
      item.deliveryLocationId <= 0
    ) {
      errors.push(`${path}.deliveryLocationId must be a positive integer.`);
    }

    if (
      typeof item.deliveryLocationName !== "string" ||
      item.deliveryLocationName.trim().length === 0 ||
      item.deliveryLocationName.length > 255
    ) {
      errors.push(`${path}.deliveryLocationName must be a non-empty string up to 255 characters.`);
    }

    if (deliveryDate && packDate && packDate > deliveryDate) {
      errors.push(`${path}.packDate must be on or before deliveryDate.`);
    }

    if (deliveryDate && stopDate && stopDate > deliveryDate) {
      errors.push(`${path}.stopDate must be on or before deliveryDate.`);
    }

    if (
      deliveryDate &&
      packDate &&
      stopDate &&
      typeof item.homeDelivery === "boolean" &&
      typeof item.deliveryLocationId === "number" &&
      Number.isInteger(item.deliveryLocationId) &&
      item.deliveryLocationId > 0 &&
      typeof item.deliveryLocationName === "string" &&
      item.deliveryLocationName.trim().length > 0 &&
      item.deliveryLocationName.length <= 255
    ) {
      const key = `${zipcode ?? "NULL"}|${dateToIso(deliveryDate)}|${item.deliveryLocationId}`;
      if (seenKeys.has(key)) {
        errors.push(
          `${path} duplicates another item with the same zipcode, deliveryDate and deliveryLocationId.`,
        );
      }
      seenKeys.add(key);

      items.push({
        zipcode,
        deliveryDate,
        packDate,
        stopDate,
        homeDelivery: item.homeDelivery,
        deliveryLocationId: item.deliveryLocationId,
        deliveryLocationName: item.deliveryLocationName.trim(),
      });
    }
  });

  if (errors.length > 0 || mode !== "upsert" && mode !== "replace_upcoming" || !replaceFromDate) {
    return { ok: false, errors };
  }

  return { ok: true, mode, replaceFromDate, items };
}

async function upsertDeliveryWindows(items: DeliveryWindowImportItem[]) {
  let created = 0;
  let updated = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const item of items) {
        const existing = await tx.deliveryWindow.findFirst({
          where: {
            zipcode: item.zipcode,
            deliveryDate: item.deliveryDate,
            deliveryLocationId: item.deliveryLocationId,
          },
          select: { id: true },
        });

        if (existing) {
          await tx.deliveryWindow.update({
            where: { id: existing.id },
            data: {
              packDate: item.packDate,
              stopDate: item.stopDate,
              homeDelivery: item.homeDelivery,
              deliveryLocationName: item.deliveryLocationName,
            },
          });
          updated++;
        } else {
          await tx.deliveryWindow.create({ data: item });
          created++;
        }
      }
    },
    { maxWait: 5000, timeout: 30000 },
  );

  return { created, updated };
}

async function replaceUpcomingDeliveryWindows(
  replaceFromDate: Date,
  items: DeliveryWindowImportItem[],
) {
  const result = await prisma.$transaction(
    async (tx) => {
      const deleted = await tx.deliveryWindow.deleteMany({
        where: { deliveryDate: { gte: replaceFromDate } },
      });

      const created = await tx.deliveryWindow.createMany({ data: items });

      return { deleted: deleted.count, created: created.count };
    },
    { maxWait: 5000, timeout: 30000 },
  );

  return result;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  return methodNotAllowed();
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  try {
    if (!hasValidApiKey(request)) {
      return json({ error: "Unauthorized. Send a valid Bearer token." }, 401);
    }
  } catch (error) {
    console.error("[delivery-windows-api] configuration error", error);
    return json({ error: "Delivery windows API is not configured." }, 500);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const validation = validatePayload(payload);
  if (!validation.ok) {
    return json({ error: "Validation failed.", details: validation.errors }, 400);
  }

  try {
    if (validation.mode === "replace_upcoming") {
      const result = await replaceUpcomingDeliveryWindows(
        validation.replaceFromDate,
        validation.items,
      );

      console.log("[delivery-windows-api] replace_upcoming", {
        replaceFromDate: dateToIso(validation.replaceFromDate),
        received: validation.items.length,
        ...result,
      });

      return json({
        ok: true,
        mode: validation.mode,
        received: validation.items.length,
        replaceFromDate: dateToIso(validation.replaceFromDate),
        ...result,
      });
    }

    const result = await upsertDeliveryWindows(validation.items);

    console.log("[delivery-windows-api] upsert", {
      received: validation.items.length,
      ...result,
    });

    return json({
      ok: true,
      mode: validation.mode,
      received: validation.items.length,
      ...result,
    });
  } catch (error) {
    console.error("[delivery-windows-api] import failed", error);
    return json({ error: "Delivery windows import failed." }, 500);
  }
}
