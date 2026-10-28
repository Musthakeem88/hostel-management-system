# Hostel Management System

University hostel management web app: rooms, students, inspections, damage fines and repair requests.
Node.js + Express + PostgreSQL on the back end; plain HTML/CSS/JavaScript on the front end (no build step).

## Run it

```bash
cd backend
npm install
cp .env.example .env     # then put your real PostgreSQL details in .env
npm start                # or: npm run dev  (auto-restart)
```

Open <http://localhost:3000>. Check the database link at <http://localhost:3000/api/health>.

`database/schema.sql` lists the five tables the code expects (see the note at the top of that file).

## Project structure

```
hostel-management-system/
├─ backend/
│  ├─ server.js            app setup: static files + mounts the routes
│  ├─ db.js                PostgreSQL connection pool (reads .env)
│  ├─ routes/
│  │  ├─ health.js         GET   /api/health
│  │  ├─ rooms.js          GET   /api/rooms
│  │  ├─ students.js       GET, POST        /api/students
│  │  ├─ inspections.js    GET, POST        /api/inspections
│  │  ├─ damages.js        GET, POST, PATCH /api/damages (/:id/status)
│  │  ├─ repairs.js        GET, POST, PATCH /api/repairs (/:id/status)
│  │  └─ maintenance.js    GET, POST, PUT /:id, PATCH /:id/complete  /api/maintenance
│  ├─ .env / .env.example  settings (keep .env private)
│  └─ package.json
├─ database/
│  └─ schema.sql           table reference
└─ frontend/
   ├─ index.html
   ├─ css/
   │  ├─ theme.css         colours for light and dark mode
   │  ├─ layout.css        sidebar, header, page shell
   │  ├─ components.css    cards, tables, forms, buttons, badges
   │  └─ responsive.css    tablet, phone (bottom tab bar, card tables), print
   └─ js/
      ├─ theme.js          light / dark switch (loaded first)
      ├─ config.js         constants and shared state
      ├─ utils.js          helpers and API request wrapper
      ├─ api.js            loads data from the backend
      ├─ views/            one file per page: dashboard, rooms, students,
      │                    inspections, damage, repairs, maintenance
      ├─ actions.js        create / update calls
      └─ app.js            rendering, navigation, events, start-up
```

The scripts in `index.html` share one global scope, so keep them in the order listed there.

## Light / dark mode and mobile

- The theme follows the device setting until you press the toggle (bottom of the sidebar, top-right on phones). Your choice is remembered in the browser.
- On tablets and phones the sidebar becomes a top bar plus a bottom tab bar, and every table turns into stacked cards. Nothing is hidden: every feature works on every screen size.

## Maintenance

The **Maintenance** page tracks room maintenance jobs: room, type (Electrical, Plumbing, Furniture, Cleaning), problem, reported date, assigned staff, status (Pending, In Progress, Completed) and expected completion date.

- **Add maintenance** form at the top; filter the list by status.
- **View** opens the full details, **Edit** changes type, status, staff, date and description, **Mark as completed** closes the job.
- Completed jobs are locked. Jobs past their expected date show an **Overdue** badge.
- The **Dashboard** shows pending / in progress / completed / overdue counts and the next open jobs.
- The `maintenance_requests` table is created automatically the first time the page is used.

## Notes

- Fines can be Pending, Under Review, Approved or Paid; Paid reports are locked. Repairs go Reported, Assigned, In Progress, Completed; Completed requests are locked.
- Never commit `backend/.env`; it is listed in `.gitignore`.
