import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "./db.server";

// Per-butik API-nyckel för det skrivande delivery-windows-API:t.
// Nyckeln genereras i admin, visas EN gång, och lagras bara som SHA-256-hash.
// Uppslag sker på hashen (deterministisk) så att vi kan hitta butiken utan att
// känna till den i förväg — anroparen skickar bara sin nyckel.

const KEY_PREFIX = "dwk_"; // delivery-windows key
const KEY_BYTES = 32;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Genererar en ny nyckel, sparar hashen för butiken (ersätter ev. befintlig —
// rotation), och returnerar klartextnyckeln EN gång. Den går inte att läsa igen.
export async function generateApiKey(
  shop: string,
  label?: string | null,
): Promise<string> {
  const key = KEY_PREFIX + randomBytes(KEY_BYTES).toString("hex");
  const hashedKey = hashApiKey(key);

  await prisma.apiCredential.upsert({
    where: { shop },
    create: { shop, hashedKey, label: label ?? null },
    update: { hashedKey, label: label ?? null, createdAt: new Date(), lastUsedAt: null },
  });

  return key;
}

// Slår upp vilken butik en nyckel tillhör. Returnerar null om nyckeln är ogiltig.
// Konstant-tids-jämförelse mot den lagrade hashen som extra skydd.
export async function resolveShopFromApiKey(key: string): Promise<string | null> {
  if (!key) return null;

  const hashedKey = hashApiKey(key);

  // Uppslag på hash (unik per nyckel i praktiken).
  const match = await prisma.apiCredential.findFirst({
    where: { hashedKey },
    select: { shop: true, hashedKey: true, id: true },
  });

  if (!match) return null;

  // Konstant-tids-bekräftelse att hashen stämmer.
  const a = Buffer.from(hashedKey);
  const b = Buffer.from(match.hashedKey);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Markera senast använd (best-effort, blockerar inte anropet).
  prisma.apiCredential
    .update({ where: { id: match.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return match.shop;
}

// Info för admin-UI:t (aldrig själva nyckeln).
export async function getApiCredentialInfo(shop: string) {
  return prisma.apiCredential.findUnique({
    where: { shop },
    select: { label: true, createdAt: true, lastUsedAt: true },
  });
}

export async function revokeApiKey(shop: string): Promise<void> {
  await prisma.apiCredential.deleteMany({ where: { shop } });
}
