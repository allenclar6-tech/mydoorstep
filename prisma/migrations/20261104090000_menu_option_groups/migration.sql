-- Glovo-style item options: choice groups on a dish (e.g. "Choose your protein", required, pick 1; "Extras", up to 3),
-- each option with its own price. Additive only: existing dishes simply have no groups.
CREATE TABLE IF NOT EXISTS "MenuOptionGroup" (
  "id" TEXT NOT NULL,
  "menuItemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "minSelect" INTEGER NOT NULL DEFAULT 0,
  "maxSelect" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MenuOptionGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MenuOptionGroup_menuItemId_idx" ON "MenuOptionGroup"("menuItemId");
DO $$ BEGIN
  ALTER TABLE "MenuOptionGroup" ADD CONSTRAINT "MenuOptionGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "MenuOption" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
ALTER TABLE "MenuOption" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "MenuOption_groupId_idx" ON "MenuOption"("groupId");
DO $$ BEGIN
  ALTER TABLE "MenuOption" ADD CONSTRAINT "MenuOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MenuOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
