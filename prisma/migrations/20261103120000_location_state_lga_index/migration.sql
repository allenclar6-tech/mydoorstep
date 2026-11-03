-- Faster filtering of the location directory by state and LGA.
CREATE INDEX IF NOT EXISTS "Location_state_localGovernmentArea_idx" ON "Location"("state", "localGovernmentArea");
