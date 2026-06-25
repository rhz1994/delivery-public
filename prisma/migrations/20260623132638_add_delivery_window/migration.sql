-- CreateTable
CREATE TABLE "DeliveryWindow" (
    "id" SERIAL NOT NULL,
    "zipcode" TEXT NOT NULL,
    "deliveryDate" DATE NOT NULL,
    "packDate" DATE NOT NULL,
    "stopDate" DATE NOT NULL,
    "homeDelivery" BOOLEAN NOT NULL,
    "deliveryLocationId" INTEGER NOT NULL,
    "deliveryLocationName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryWindow_zipcode_idx" ON "DeliveryWindow"("zipcode");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryWindow_zipcode_deliveryDate_deliveryLocationId_key" ON "DeliveryWindow"("zipcode", "deliveryDate", "deliveryLocationId");
