-- Remove the FK cascade from profiles so that deleting a Supabase auth user
-- does not cascade-delete the profile row. This lets us keep a "deleted" profile
-- as a read-only text record in the Deleted tab even after the auth user is gone.
-- delete-workspace explicitly deletes profiles before auth users, so that flow is unaffected.
ALTER TABLE profiles DROP CONSTRAINT profiles_id_fkey;
