-- AlterTable
ALTER TABLE "flash_sales" ADD COLUMN     "settled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "outbox" ALTER COLUMN "visible_at" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "idx_flash_sales_settlement" ON "flash_sales"("ends_at", "settled_at");
