-- Kannai Fitness Studio - Supabase Setup SQL
-- Run this in the Supabase SQL editor to initialize the database.
-- Safe to re-run: uses CREATE IF NOT EXISTS and ON CONFLICT upserts.
-- Includes migration block at the bottom for existing installs upgrading trainee → trainer.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- TRIGGER HELPER: auto-update updated_at column
-- ─────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- TABLE: settings
-- ─────────────────────────────────────────────
create table if not exists public.settings (
  id integer primary key default 1,
  gym_name text not null default 'Kannai Fitness Studio',
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_single_row check (id = 1)
);

drop trigger if exists trg_settings_updated_at on public.settings;
create trigger trg_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────
-- TABLE: app_users  (manager and trainer staff)
-- ─────────────────────────────────────────────
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text,
  role text not null check (role in ('manager', 'trainer')),
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

create index if not exists idx_app_users_email on public.app_users(email);
create index if not exists idx_app_users_role on public.app_users(role);

-- ─────────────────────────────────────────────
-- TABLE: members  (public gym members)
-- ─────────────────────────────────────────────
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  member_no text not null unique,
  full_name text not null,
  phone text,
  email text,
  gender text,
  date_of_birth date,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  plan_name text,
  plan_duration_months integer,
  plan_start_date date,
  plan_end_date date,
  plan_status text,
  notification_enabled boolean not null default true,
  assigned_trainer_id uuid references public.app_users(id) on delete set null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_members_updated_at on public.members;
create trigger trg_members_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

create index if not exists idx_members_member_no on public.members(member_no);
create index if not exists idx_members_phone on public.members(phone);
create index if not exists idx_members_email on public.members(email);
create index if not exists idx_members_plan_status on public.members(plan_status);
create index if not exists idx_members_is_active on public.members(is_active);
create index if not exists idx_members_full_name on public.members(full_name);
create index if not exists idx_members_assigned_trainer_id on public.members(assigned_trainer_id);

-- ─────────────────────────────────────────────
-- TABLE: attendance
-- ─────────────────────────────────────────────
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  person_type text not null check (person_type in ('member', 'trainer')),
  person_id uuid not null,
  role text not null,
  in_at timestamptz not null default now(),
  out_at timestamptz,
  source text not null default 'kiosk',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_attendance_updated_at on public.attendance;
create trigger trg_attendance_updated_at
  before update on public.attendance
  for each row execute function public.set_updated_at();

create index if not exists idx_attendance_person on public.attendance(person_type, person_id);
create index if not exists idx_attendance_person_open on public.attendance(person_type, person_id, out_at);
create index if not exists idx_attendance_in_at on public.attendance(in_at desc);
create index if not exists idx_attendance_out_at on public.attendance(out_at) where out_at is null;

-- ─────────────────────────────────────────────
-- TABLE: pt_sessions
-- ─────────────────────────────────────────────
create table if not exists public.pt_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  trainer_id uuid not null references public.app_users(id) on delete cascade,
  session_date date not null,
  start_time time,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'missed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pt_sessions_updated_at on public.pt_sessions;
create trigger trg_pt_sessions_updated_at
  before update on public.pt_sessions
  for each row execute function public.set_updated_at();

create index if not exists idx_sessions_date on public.pt_sessions(session_date desc);
create index if not exists idx_sessions_trainer on public.pt_sessions(trainer_id);
create index if not exists idx_sessions_member on public.pt_sessions(member_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table public.settings enable row level security;
alter table public.app_users enable row level security;
alter table public.members enable row level security;
alter table public.attendance enable row level security;
alter table public.pt_sessions enable row level security;

-- ─────────────────────────────────────────────
-- MIGRATION: trainee → trainer  (safe for existing installs)
-- This block renames old columns/constraints. No-op on fresh installs.
-- ─────────────────────────────────────────────

-- 1. Migrate role values before constraint change
update public.app_users set role = 'trainer' where role = 'trainee';

-- 2. Update app_users role constraint
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('manager', 'trainer'));

-- 3. Rename members.assigned_trainee_id → assigned_trainer_id (if old column exists)
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'assigned_trainee_id'
  ) then
    alter table public.members rename column assigned_trainee_id to assigned_trainer_id;
  end if;
end $$;

-- 4. Rename pt_sessions.trainee_id → trainer_id (if old column exists)
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pt_sessions' and column_name = 'trainee_id'
  ) then
    alter table public.pt_sessions rename column trainee_id to trainer_id;
  end if;
end $$;

-- 5. Migrate attendance person_type values
update public.attendance set person_type = 'trainer' where person_type = 'trainee';
update public.attendance set role = 'trainer' where role = 'trainee';

-- 6. Update attendance person_type constraint
alter table public.attendance drop constraint if exists attendance_person_type_check;
alter table public.attendance add constraint attendance_person_type_check check (person_type in ('member', 'trainer'));

-- ─────────────────────────────────────────────
-- DEMO DATA
-- Password for all demo users: 123456 (bcrypt hash, 10 rounds)
-- ─────────────────────────────────────────────

insert into public.settings (id, gym_name, notifications_enabled)
values (1, 'Kannai Fitness Studio', true)
on conflict (id) do update set
  gym_name = excluded.gym_name,
  notifications_enabled = excluded.notifications_enabled,
  updated_at = now();

insert into public.app_users (id, name, email, phone, role, password_hash, is_active)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'Gym Manager',
    'manager@gym.com',
    '9000000001',
    'manager',
    '$2b$10$V5OkMZ64EnS//QdGP0vuk.EhtuvqSLtN/B13Xc/Hw61xLt0KDH85u',
    true
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Senior Trainer',
    'trainer@gym.com',
    '9000000002',
    'trainer',
    '$2b$10$q6RVE.KvhdvGU1l9B1R.kuzvjZFi2u5KzVtwyaVHxJTW9Vw39CSTO',
    true
  )
on conflict (id) do update set
  name          = excluded.name,
  email         = excluded.email,
  phone         = excluded.phone,
  role          = excluded.role,
  password_hash = excluded.password_hash,
  is_active     = excluded.is_active,
  updated_at    = now();

insert into public.members (
  id, member_no, full_name, phone, email, gender, date_of_birth,
  address, emergency_contact_name, emergency_contact_phone,
  plan_name, plan_duration_months, plan_start_date, plan_end_date, plan_status,
  notification_enabled, assigned_trainer_id, notes, is_active
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '1001', 'Arjun Kumar', '9876501001', 'arjun@example.com',
    'Male', '1999-05-15',
    'Chennai', 'Kumar Senior', '9876509999',
    'Monthly', 1,
    (current_date - interval '20 days')::date,
    current_date,
    'expires-today',
    true, '22222222-2222-2222-2222-222222222222',
    'Wants fat loss plan',
    true
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '1002', 'Nisha Rao', '9876501002', 'nisha@example.com',
    'Female', '1995-11-22',
    'Tambaram', 'Rao Family', '9876508888',
    '6 Months', 6,
    (current_date - interval '2 months')::date,
    (current_date + interval '4 months')::date,
    'active',
    true, '22222222-2222-2222-2222-222222222222',
    'PT client',
    true
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '1003', 'Rahul S', '9876501003', null,
    'Male', '1993-03-08',
    'Saidapet', null, null,
    '1 Year', 12,
    (current_date - interval '4 months')::date,
    (current_date + interval '8 months')::date,
    'active',
    false, null,
    null,
    true
  )
on conflict (id) do update set
  member_no               = excluded.member_no,
  full_name               = excluded.full_name,
  phone                   = excluded.phone,
  email                   = excluded.email,
  gender                  = excluded.gender,
  date_of_birth           = excluded.date_of_birth,
  address                 = excluded.address,
  emergency_contact_name  = excluded.emergency_contact_name,
  emergency_contact_phone = excluded.emergency_contact_phone,
  plan_name               = excluded.plan_name,
  plan_duration_months    = excluded.plan_duration_months,
  plan_start_date         = excluded.plan_start_date,
  plan_end_date           = excluded.plan_end_date,
  plan_status             = excluded.plan_status,
  notification_enabled    = excluded.notification_enabled,
  assigned_trainer_id     = excluded.assigned_trainer_id,
  notes                   = excluded.notes,
  is_active               = excluded.is_active,
  updated_at              = now();

insert into public.pt_sessions (id, member_id, trainer_id, session_date, start_time, status, notes)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222',
  current_date,
  '18:00',
  'scheduled',
  'Leg day and mobility'
)
on conflict (id) do update set
  member_id    = excluded.member_id,
  trainer_id   = excluded.trainer_id,
  session_date = excluded.session_date,
  start_time   = excluded.start_time,
  status       = excluded.status,
  notes        = excluded.notes,
  updated_at   = now();
