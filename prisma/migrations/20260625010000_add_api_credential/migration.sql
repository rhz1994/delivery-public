-- Per-butik API-nyckel för det skrivande delivery-windows-API:t.
-- En aktiv nyckel per butik (shop unik); nyckeln lagras bara hashad.

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiCredential_shop_key" ON "ApiCredential"("shop");
