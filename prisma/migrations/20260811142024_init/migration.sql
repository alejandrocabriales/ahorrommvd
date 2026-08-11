-- CreateEnum
CREATE TYPE "payment_type" AS ENUM ('CREDITO', 'DEBITO', 'AMBOS');

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_chains" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "merchant_chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "merchant_chain_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "neighborhood" TEXT,
    "format" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "bank_id" TEXT NOT NULL,
    "merchant_chain_id" TEXT NOT NULL,
    "discount_percentage" DECIMAL(5,2) NOT NULL,
    "payment_type" "payment_type" NOT NULL,
    "card_name" TEXT,
    "cap_amount" DECIMAL(10,2),
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "source_url" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "applies_to_all_branches" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_branches" (
    "promotion_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "promotion_branches_pkey" PRIMARY KEY ("promotion_id","branch_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "preferred_branch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saving_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "estimated_saving" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saving_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banks_name_key" ON "banks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_chains_name_key" ON "merchant_chains"("name");

-- CreateIndex
CREATE INDEX "merchant_chains_category_id_idx" ON "merchant_chains"("category_id");

-- CreateIndex
CREATE INDEX "branches_merchant_chain_id_idx" ON "branches"("merchant_chain_id");

-- CreateIndex
CREATE INDEX "promotions_merchant_chain_id_valid_from_valid_until_idx" ON "promotions"("merchant_chain_id", "valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "promotions_bank_id_idx" ON "promotions"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_whatsapp_key" ON "users"("whatsapp");

-- CreateIndex
CREATE INDEX "saving_logs_user_id_created_at_idx" ON "saving_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "merchant_chains" ADD CONSTRAINT "merchant_chains_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_merchant_chain_id_fkey" FOREIGN KEY ("merchant_chain_id") REFERENCES "merchant_chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_merchant_chain_id_fkey" FOREIGN KEY ("merchant_chain_id") REFERENCES "merchant_chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_branches" ADD CONSTRAINT "promotion_branches_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_branches" ADD CONSTRAINT "promotion_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_branch_id_fkey" FOREIGN KEY ("preferred_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saving_logs" ADD CONSTRAINT "saving_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saving_logs" ADD CONSTRAINT "saving_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
