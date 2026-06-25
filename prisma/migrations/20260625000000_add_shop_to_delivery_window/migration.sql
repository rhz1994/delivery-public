-- Multi-tenant: varje leveransfönster ägs av en butik (shop).
-- Befintliga rader saknar shop och töms (datan importeras om per butik).

-- Töm tabellen så att NOT NULL-kolumnen kan läggas till utan backfill.
TRUNCATE TABLE "DeliveryWindow" RESTART IDENTITY;

-- DropIndex (gamla, shop-lösa index)
DROP INDEX "DeliveryWindow_zipcode_idx";
DROP INDEX "DeliveryWindow_zipcode_deliveryDate_deliveryLocationId_key";

-- AlterTable: lägg till shop
ALTER TABLE "DeliveryWindow" ADD COLUMN "shop" TEXT NOT NULL;

-- CreateIndex (shop-medvetna)
CREATE INDEX "DeliveryWindow_shop_zipcode_idx" ON "DeliveryWindow"("shop", "zipcode");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryWindow_shop_zipcode_deliveryDate_deliveryLocationId_key" ON "DeliveryWindow"("shop", "zipcode", "deliveryDate", "deliveryLocationId");
