-- Staff roles for admin accounts. Additive: existing admins have no value and keep full access (Super admin).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminRole" TEXT;
