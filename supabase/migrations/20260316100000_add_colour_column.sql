BEGIN;

ALTER TABLE time_off_categories
  ADD COLUMN IF NOT EXISTS colour text NOT NULL DEFAULT 'red';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_off_categories_colour_check') THEN
    ALTER TABLE time_off_categories
      ADD CONSTRAINT time_off_categories_colour_check
      CHECK (colour IN ('red', 'orange', 'green', 'blue', 'gray'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
