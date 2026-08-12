-- AlterTable
ALTER TABLE "users" ADD COLUMN     "conversation_context" JSONB,
ADD COLUMN     "known_zone" TEXT;
