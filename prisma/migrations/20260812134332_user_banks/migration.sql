-- CreateTable
CREATE TABLE "_BankToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BankToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_BankToUser_B_index" ON "_BankToUser"("B");

-- AddForeignKey
ALTER TABLE "_BankToUser" ADD CONSTRAINT "_BankToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BankToUser" ADD CONSTRAINT "_BankToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
