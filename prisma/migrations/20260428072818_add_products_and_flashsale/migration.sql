-- AlterTable
ALTER TABLE "outbox" ALTER COLUMN "visible_at" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "stock" BIGINT NOT NULL,
    "price_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sale_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flash_sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "price_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "flash_sale_item_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "price_cents" BIGINT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "idx_flash_sales_window" ON "flash_sales"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "idx_flash_sale_items_sale" ON "flash_sale_items"("flash_sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sale_items_flash_sale_id_product_id_key" ON "flash_sale_items"("flash_sale_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_idempotency_key_key" ON "purchases"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_user_id_day_key" ON "purchases"("user_id", "day");

-- CHECK constraints (not emitted by Prisma generator)
ALTER TABLE "products" ADD CONSTRAINT "products_stock_nonneg" CHECK (stock >= 0);
ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_window_valid" CHECK (ends_at > starts_at);
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_quantity_pos" CHECK (quantity > 0);
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_sold_valid" CHECK (sold >= 0 AND sold <= quantity);

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_flash_sale_id_fkey" FOREIGN KEY ("flash_sale_id") REFERENCES "flash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_flash_sale_item_id_fkey" FOREIGN KEY ("flash_sale_item_id") REFERENCES "flash_sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
