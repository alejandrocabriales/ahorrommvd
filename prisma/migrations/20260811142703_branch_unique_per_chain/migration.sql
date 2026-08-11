-- DropIndex
DROP INDEX "branches_merchant_chain_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "branches_merchant_chain_id_name_key" ON "branches"("merchant_chain_id", "name");
