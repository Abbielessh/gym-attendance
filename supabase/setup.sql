create extension if not exists pgcrypto;

create table if not exists public.settings (
  id integer primary key default 1,
  gym_name text not null default 'Kannai Fitness Studio',
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_single_row check (id = 1)
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text,
  role text not null check (role in ('manager', 'trainee')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  member_code text not null unique,
  name text not null,
  phone text unique,
  age integer,
  gender text,
  address text,
  emergency_contact text,
  plan_type text not null default 'Monthly',
  plan_start_date date not null default current_date,
  plan_expiry_date date not null default current_date,
  plan_notify boolean not null default true,
  assigned_trainee_id uuid references public.app_users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  person_type text not null check (person_type in ('member', 'trainee')),
  person_id uuid not null,
  role text not null,
  in_at timestamptz not null default now(),
  out_at timestamptz,
  source text not null default 'kiosk',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pt_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  trainee_id uuid not null references public.app_users(id) on delete cascade,
  session_date date not null,
  start_time time,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'missed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_members_member_code on public.members(member_code);
create index if not exists idx_members_phone on public.members(phone);
create index if not exists idx_attendance_person_open on public.attendance(person_type, person_id, out_at);
create index if not exists idx_attendance_in_at on public.attendance(in_at desc);
create index if not exists idx_sessions_date on public.pt_sessions(session_date desc);

alter table public.settings enable row level security;
alter table public.app_users enable row level security;
alter table public.members enable row level security;
alter table public.attendance enable row level security;
alter table public.pt_sessions enable row level security;

insert into public.settings (id, gym_name, notifications_enabled)
values (1, 'Kannai Fitness Studio', true)
on conflict (id) do update set
  gym_name = excluded.gym_name,
  notifications_enabled = excluded.notifications_enabled,
  updated_at = now();

insert into public.app_users (id, name, email, phone, role, password_hash, active)
values
  ('11111111-1111-1111-1111-111111111111', 'Gym Manager', 'manager@gym.com', '9000000001', 'manager', 'scrypt:dbcf26307704b602fe5bacdfdfdab053:c395e5d421e70e40a6f86ad3bf4eff775f5e67aa9db1aa97d3d8ab7c507a5c7dc935d736104ea843ba9ff8519e1d7fd9fb70ddfc74eb4fbae3b930fecf4592ad', true),
  ('22222222-2222-2222-2222-222222222222', 'Senior Trainee', 'trainee@gym.com', '9000000002', 'trainee', 'scrypt:bece0442054d6cc5f7062508c28eef5f:456865e5bd09333512e3b9c764e9febaf4b02e2a3023f6f381256a81b793ffea8a58524ac6312d9a480245c3fa3b2a16c9b63780004709be66252dd630182ec3', true)
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  phone = excluded.phone,
  role = excluded.role,
  password_hash = excluded.password_hash,
  active = excluded.active,
  updated_at = now();

insert into public.members (
  id, member_code, name, phone, age, gender, address, emergency_contact,
  plan_type, plan_start_date, plan_expiry_date, plan_notify,
  assigned_trainee_id, status, notes
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1001', 'Arjun Kumar', '9876501001', 25, 'Male', 'Chennai', '9876509999', 'Monthly', (current_date - interval '20 days')::date, current_date, true, '22222222-2222-2222-2222-222222222222', 'active', 'Wants fat loss plan'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '1002', 'Nisha Rao', '9876501002', 29, 'Female', 'Tambaram', '9876508888', '6 Months', (current_date - interval '2 months')::date, (current_date + interval '4 months')::date, true, '22222222-2222-2222-2222-222222222222', 'active', 'PT client'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '1003', 'Rahul S', '9876501003', 31, 'Male', 'Saidapet', null, '1 Year', (current_date - interval '4 months')::date, (current_date + interval '8 months')::date, false, null, 'active', null)
on conflict (id) do update set
  member_code = excluded.member_code,
  name = excluded.name,
  phone = excluded.phone,
  age = excluded.age,
  gender = excluded.gender,
  address = excluded.address,
  emergency_contact = excluded.emergency_contact,
  plan_type = excluded.plan_type,
  plan_start_date = excluded.plan_start_date,
  plan_expiry_date = excluded.plan_expiry_date,
  plan_notify = excluded.plan_notify,
  assigned_trainee_id = excluded.assigned_trainee_id,
  status = excluded.status,
  notes = excluded.notes,
  updated_at = now();

insert into public.pt_sessions (id, member_id, trainee_id, session_date, start_time, status, notes)
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
  member_id = excluded.member_id,
  trainee_id = excluded.trainee_id,
  session_date = excluded.session_date,
  start_time = excluded.start_time,
  status = excluded.status,
  notes = excluded.notes,
  updated_at = now();
