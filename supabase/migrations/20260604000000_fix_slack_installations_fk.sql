-- Fix slack_installations.installed_by FK to SET NULL on profile deletion.
-- Previously, purging a deleted employee who had installed Slack would fail
-- with a FK violation. Now the reference becomes NULL, preserving the
-- installation record (Slack bot still works) while allowing profile removal.
ALTER TABLE slack_installations
  DROP CONSTRAINT slack_installations_installed_by_fkey,
  ADD CONSTRAINT slack_installations_installed_by_fkey
    FOREIGN KEY (installed_by) REFERENCES profiles(id) ON DELETE SET NULL;
