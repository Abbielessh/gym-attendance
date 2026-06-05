# Kannai Fitness Studio Supabase

A professional Node, Express, and Supabase web app for gym attendance, public member plans, trainee attendance, and PT session tracking.

## Features

- Public attendance kiosk with numpad
- Member number or phone number check-in and check-out
- Manager dashboard
- Trainee dashboard
- Manual attendance add
- Public member personal details
- Monthly, 6 months, 1 year, and custom plan dates
- Plan expiry notification toggle per member
- Trainee attendance punch
- PT session client tracking
- Supabase database, no local JSON database
- Responsive UI with full-page background image support
- Emoji-free interface

## Folder structure

```txt
kannai-fitness-studio/
  public/
    index.html
    kiosk.html
    dashboard.html
    assets/
      css/styles.css
      js/common.js
      js/login.js
      js/kiosk.js
      js/dashboard.js
      img/
  src/
    routes/auth.js
    routes/api.js
    supabaseClient.js
    mappers.js
    middleware.js
    passwords.js
  supabase/setup.sql
  scripts/check-supabase.js
  .env.example
  package.json
```

## Step 1: Create the Supabase project

1. Go to Supabase.
2. Create a new project.
3. Wait until the project is ready.
4. Open the project dashboard.
5. Go to SQL Editor.
6. Open `supabase/setup.sql` from this project.
7. Copy the full SQL.
8. Paste it into Supabase SQL Editor.
9. Click Run.

This creates these tables:

```txt
settings
app_users
members
attendance
pt_sessions
```

It also inserts demo data.

## Step 2: Get Supabase keys

In Supabase dashboard:

```txt
Project Settings -> API
```

Copy:

```txt
Project URL
service_role key
```

Important: Use the service role key only in the Node server `.env` file. Never put it in frontend JavaScript.

## Step 3: Create `.env`

Copy `.env.example` and rename it to `.env`.

Fill it like this:

```env
PORT=3000
SESSION_SECRET=use-a-long-random-secret-here
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Step 4: Install and run

```bash
cd kannai-fitness-studio
npm install
npm run check
npm start
```

Open:

```txt
http://localhost:3000/login
```

Public kiosk:

```txt
http://localhost:3000/kiosk
```

## Demo login

Manager:

```txt
manager@gym.com
123456
```

Trainee:

```txt
trainee@gym.com
123456
```

Sample member numbers for kiosk:

```txt
1001
1002
1003
```

## Canva assets

Read:

```txt
CANVA_PROMPTS.md
```

Required files:

```txt
public/assets/img/logo-gym.png
public/assets/img/bg-gym.jpg
```

The app still runs without the logo. The background has a fallback gradient, but for the final professional look, generate and save `bg-gym.jpg`.

## How attendance works

Public members use the kiosk page.

First entry of the member number saves IN time.

Second entry of the same member number saves OUT time.

The kiosk accepts either:

```txt
member_code
phone
```

For example:

```txt
1001
9876501001
```

## Plan notification logic

Each member has:

```txt
plan_type
plan_start_date
plan_expiry_date
plan_notify
```

If `plan_notify` is enabled, the dashboard shows the member in plan alerts when the plan is expired, expires today, or expires within 7 days.

## Production note

This project uses Express memory sessions for simple local usage. For real production with many users, replace the default session store with Redis, PostgreSQL session storage, or another persistent session store.
