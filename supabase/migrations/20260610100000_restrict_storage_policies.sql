-- Restrict storage bucket policies to workspace-scoped access.
-- Previously any authenticated user could upload/update/delete any file.
--
-- Path conventions:
--   logos   → logos/{workspace_id}/{filename}
--   avatars → avatars/employees/{filename}  (admin uploading employee avatar)
--             avatars/{user_id}/{filename}   (user uploading own avatar)

drop policy if exists storage_logos_insert on storage.objects;
drop policy if exists storage_logos_update on storage.objects;
drop policy if exists storage_logos_delete on storage.objects;
drop policy if exists storage_avatars_insert on storage.objects;
drop policy if exists storage_avatars_update on storage.objects;
drop policy if exists storage_avatars_delete on storage.objects;

-- Logos: only owner/admin of the matching workspace may write
create policy storage_logos_insert on storage.objects
  for insert with check (
    bucket_id = 'logos'
    and auth.uid() is not null
    and exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'admin')
        and workspace_id::text = (storage.foldername(name))[1]
        and status != 'deleted'
    )
  );

create policy storage_logos_update on storage.objects
  for update using (
    bucket_id = 'logos'
    and auth.uid() is not null
    and exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'admin')
        and workspace_id::text = (storage.foldername(name))[1]
        and status != 'deleted'
    )
  );

create policy storage_logos_delete on storage.objects
  for delete using (
    bucket_id = 'logos'
    and auth.uid() is not null
    and exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'admin')
        and workspace_id::text = (storage.foldername(name))[1]
        and status != 'deleted'
    )
  );

-- Avatars: two permitted paths
--   1. avatars/employees/... → admin/owner only (uploading on behalf of employee)
--   2. avatars/{user_id}/... → the user themselves (own profile photo)
create policy storage_avatars_insert on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (
      -- Admin uploading employee avatar (shared folder "employees")
      (
        (storage.foldername(name))[1] = 'employees'
        and exists (
          select 1 from profiles
          where id = auth.uid()
            and role in ('owner', 'admin')
            and status != 'deleted'
        )
      )
      or
      -- User uploading their own avatar (folder = their user id)
      (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create policy storage_avatars_update on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (
      (
        (storage.foldername(name))[1] = 'employees'
        and exists (
          select 1 from profiles
          where id = auth.uid()
            and role in ('owner', 'admin')
            and status != 'deleted'
        )
      )
      or
      (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create policy storage_avatars_delete on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (
      (
        (storage.foldername(name))[1] = 'employees'
        and exists (
          select 1 from profiles
          where id = auth.uid()
            and role in ('owner', 'admin')
            and status != 'deleted'
        )
      )
      or
      (storage.foldername(name))[1] = auth.uid()::text
    )
  );
