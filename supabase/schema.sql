-- Jen's Personal Dashboard
-- Run this in the SQL editor for the separate Supabase project.

create table if not exists public.dashboard_tasks (
  id uuid primary key default gen_random_uuid(),
  dashboard_id text not null default 'jen-dashboard',
  user_id uuid references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  notes text,
  area text not null default 'today'
    check (area in ('today', 'ukg', 'money', 'business', 'home', 'admin', 'wishlist', 'someday')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  status text not null default 'active'
    check (status in ('active', 'done', 'cleared')),
  due_at timestamptz,
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes >= 0),
  cost_estimate numeric(12, 2) check (cost_estimate is null or cost_estimate >= 0),
  saved_amount numeric(12, 2) check (saved_amount is null or saved_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_tasks
add column if not exists dashboard_id text not null default 'jen-dashboard';

alter table public.dashboard_tasks
alter column dashboard_id set default 'jen-dashboard';

alter table public.dashboard_tasks
alter column user_id drop not null;

alter table public.dashboard_tasks
drop constraint if exists dashboard_tasks_area_check;

alter table public.dashboard_tasks
add constraint dashboard_tasks_area_check
check (area in ('today', 'ukg', 'money', 'business', 'home', 'admin', 'wishlist', 'someday'));

alter table public.dashboard_tasks
drop constraint if exists dashboard_tasks_status_check;

alter table public.dashboard_tasks
add constraint dashboard_tasks_status_check
check (status in ('active', 'done', 'cleared'));

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

create or replace function public.set_dashboard_tasks_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_dashboard_tasks_updated_at on public.dashboard_tasks;
create trigger set_dashboard_tasks_updated_at
before update on public.dashboard_tasks
for each row
execute function public.set_dashboard_tasks_updated_at();
