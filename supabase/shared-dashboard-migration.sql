-- Switch Jen's dashboard from account-based sync to one shared link-based board.
-- Run this once in the Supabase SQL editor.

alter table public.dashboard_tasks
add column if not exists dashboard_id text not null default 'jen-dashboard';

alter table public.dashboard_tasks
alter column dashboard_id set default 'jen-dashboard';

alter table public.dashboard_tasks
alter column user_id drop not null;

alter table public.dashboard_tasks enable row level security;

grant select, insert, update, delete on public.dashboard_tasks to anon, authenticated;

drop policy if exists "Users can read their own dashboard tasks" on public.dashboard_tasks;
drop policy if exists "Users can create their own dashboard tasks" on public.dashboard_tasks;
drop policy if exists "Users can update their own dashboard tasks" on public.dashboard_tasks;
drop policy if exists "Users can delete their own dashboard tasks" on public.dashboard_tasks;
drop policy if exists "Shared dashboard can read tasks" on public.dashboard_tasks;
drop policy if exists "Shared dashboard can create tasks" on public.dashboard_tasks;
drop policy if exists "Shared dashboard can update tasks" on public.dashboard_tasks;
drop policy if exists "Shared dashboard can delete tasks" on public.dashboard_tasks;

create policy "Shared dashboard can read tasks"
on public.dashboard_tasks
for select
to anon, authenticated
using (dashboard_id = 'jen-dashboard');

create policy "Shared dashboard can create tasks"
on public.dashboard_tasks
for insert
to anon, authenticated
with check (dashboard_id = 'jen-dashboard');

create policy "Shared dashboard can update tasks"
on public.dashboard_tasks
for update
to anon, authenticated
using (dashboard_id = 'jen-dashboard')
with check (dashboard_id = 'jen-dashboard');

create policy "Shared dashboard can delete tasks"
on public.dashboard_tasks
for delete
to anon, authenticated
using (dashboard_id = 'jen-dashboard');
