# Kannai Fitness Studio

A professional Node.js + Express + Supabase gym management app with secure authentication, full member CRUD, Excel import, and attendance tracking.

## Features

- Secure login with bcrypt password hashing
- Public attendance kiosk with numpad (member number or phone)
- Manager dashboard (overview, members, attendance, PT sessions, trainees)
- Trainee dashboard (assigned members and sessions)
- Full member CRUD with server-rendered EJS pages
- Excel / CSV bulk import with editable preview before insert
- Plan expiry notifications and alerts
- PT session scheduling and status tracking
- Supabase PostgreSQL database only (no local db.json)
- Responsive, professional UI without emojis
- Role-based access: manager and trainee

## Folder Structure

```txt
kannai-fitness-studio/
  public/
    index.html          login page (SPA)
    kiosk.html          public kiosk page
    dashboard.html      manager/trainee dashboard (SPA)
    assets/
      css/styles.css
      js/common.js
      js/login.js
      js/kiosk.js
      js/dashboard.js
      img/              place your Canva images here
  src/
    routes/auth.js      login / logout / me
    routes/api.js       JSON API for SPA dashboard
    routes/members.js   EJS member CRUD routes
    routes/membersImport.js  Excel import routes
    supabaseClient.js
    mappers.js
    middleware.js
    passwords.js
  views/
    partials/head.ejs
    partials/nav.ejs
    partials/foot.ejs
    error.ejs
    members/
      index.ejs         member list with search
      new.ejs           add member form
      edit.ejs          edit member form
      show.ejs          member detail view
      import.ejs        upload Excel file
      preview.ejs       editable import preview
      result.ejs        import result summary
  supabase/setup.sql
  .env.example
  package.json
```

---

## Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New Project** and wait until it is ready.
3. Open the project dashboard.
4. In the left sidebar, click **SQL Editor**.
5. Open `supabase/setup.sql` from this project.
6. Copy the entire file and paste it into the SQL Editor.
7. Click **Run**.

Tables created:

| Table       | Purpose                              |
|-------------|--------------------------------------|
| settings    | Gym name and notification flag       |
| app_users   | Staff accounts (manager, trainee)    |
| members     | Public gym members                   |
| attendance  | Check-in / check-out records         |
| pt_sessions | Personal training session records    |

---

## Step 2: Get Supabase Keys

In Supabase dashboard:

```
Project Settings → API
```

Copy:

- **Project URL** (starts with `https://`)
- **service_role** key (secret — use only in the server `.env`)

---

## Step 3: Set Up `.env`

Copy `.env.example` and rename it to `.env`:

```env
PORT=3000
SESSION_SECRET=your-long-random-secret
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### Generate a session secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Paste the output as `SESSION_SECRET`.

---

## Step 4: Install and Run

```bash
cd kannai-fitness-studio
npm install
npm run check
npm start
```

Open in browser:

```
http://localhost:3000/
```

Public kiosk:

```
http://localhost:3000/kiosk
```

Members management (EJS):

```
http://localhost:3000/members
```

---

## Demo Login

| Role    | Email               | Password |
|---------|---------------------|----------|
| Manager | manager@gym.com     | 123456   |
| Trainee | trainee@gym.com     | 123456   |

Passwords are stored as bcrypt hashes. The plain-text password is never saved.

Sample member numbers for kiosk test:

```
1001   (plan expires today — demo alert)
1002   (active plan)
1003   (active plan, notification disabled)
```

---

## How to Import Members from Excel

1. Log in as manager.
2. Click **Import Excel** in the navigation bar, or go to `/members/import`.
3. Select your `.xlsx`, `.xls`, or `.csv` file.
4. Click **Upload and Preview**.
5. The server parses the file and shows a preview table.
6. Review each row. Edit cells directly in the table.
   - Rows marked **Insert** are new members.
   - Rows marked **Update** will overwrite existing records matched by member number.
   - Rows with **Errors** are highlighted. Fix them or they will be skipped.
7. Click **Confirm Import** to process valid rows.
8. A result summary shows inserted, updated, skipped, and error counts.

### Supported Excel Column Names

Your file can use any of these column headers (case and spacing are flexible):

| Your Column Header           | Maps To              |
|------------------------------|----------------------|
| Member No, Member Number, ID | member_no            |
| Name, Full Name              | full_name            |
| Phone, Mobile, Contact       | phone                |
| Email                        | email                |
| Gender                       | gender               |
| DOB, Date of Birth           | date_of_birth        |
| Address                      | address              |
| Emergency Name, Emergency Contact | emergency_contact_name |
| Emergency Phone, Emergency Mobile | emergency_contact_phone |
| Plan, Plan Name, Package     | plan_name            |
| Duration, Months             | plan_duration_months |
| Start Date, Joining Date     | plan_start_date      |
| End Date, Expiry Date        | plan_end_date        |
| Notification, Notify         | notification_enabled |
| Trainer Email, Trainee Email, PT Trainer | assigned_trainee_email |
| Notes, Remarks               | notes                |

**Tips:**

- If **End Date** is empty but **Start Date** and **Duration** are given, the end date is auto-calculated.
- Use the trainer's login email to assign a PT trainer.
- Date formats accepted: `YYYY-MM-DD`, `DD-MM-YYYY`, `MM/DD/YYYY`, `DD/MM/YYYY`.
- Notification values: `Yes`/`No`, `True`/`False`, `1`/`0`.

---

## Where to Place Canva Images

```
public/assets/img/logo-gym.webp     gym logo
public/assets/img/bg-gym.jpg       login page background
```

The app runs without these images. Background uses a gradient fallback.

---

## Security Notes

- Passwords are hashed with **bcrypt** (10 rounds). Plain-text passwords are never stored or logged.
- The Supabase service role key lives only in `.env` on the server. It is never sent to the browser.
- Session cookies are `httpOnly` and `sameSite: lax`. Secure flag is enabled in production.
- All member CRUD and import routes require authentication and manager role.

---

## Production Note

This app uses Express in-memory sessions. For production with multiple server instances or restarts, replace the default session store with a persistent one such as `connect-pg-simple` (PostgreSQL) or `connect-redis`.

---

## Tech Stack

| Layer    | Technology               |
|----------|--------------------------|
| Runtime  | Node.js                  |
| Server   | Express                  |
| Views    | EJS (server-rendered)    |
| Auth     | express-session + bcrypt |
| Database | Supabase (PostgreSQL)    |
| Import   | multer + xlsx            |
