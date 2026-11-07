# Hostel Management System

University hostel management web app: rooms, students, room applications, inspections, damage fines, fees,
repairs, maintenance, visitors, leave and more. Six roles: student, warden, administrator, maintenance,
security and management.

## Backend (Express + PostgreSQL + JWT)

```bash
createdb hostel_management        # create an empty PostgreSQL database once
cd backend
cp .env.example .env              # then set DB_PASSWORD, JWT_SECRET and ADMIN_PASSWORD
npm install
npm run dev                       # http://localhost:3000   (or: npm start)
npm run seed:demo                 # optional sample data, every demo account uses Demo@1234
npm test
```

Data is stored in PostgreSQL. The tables are created automatically on the first start from
`backend/migrations/*.sql` (keep that folder). The first administrator comes from `ADMIN_USERNAME` /
`ADMIN_PASSWORD` and must change the password at first sign-in. Check the database link at
`http://localhost:3000/api/health`.

`npm test` uses a separate database that is wiped on every run, so create it once:
`createdb hostel_management_test` (the name must end in `_test`; change it with `TEST_DB_NAME`).

### API

All `/api` routes except health, login and register need `Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | – | Server and database check |
| POST | `/api/auth/register` | – | Student sign-up (student must already be on the student list) |
| POST | `/api/auth/login` | – | Login, returns a JWT |
| POST | `/api/auth/logout` | Bearer | Sign out (this token stops working at once) |
| GET | `/api/auth/me` | Bearer | Current user |
| POST | `/api/auth/change-password` | Bearer | Change own password |
| GET | `/api/users` | Admin | List users |
| POST | `/api/users` | Admin | Create a new user |
| PUT | `/api/users/:id` | Admin | Edit a user (role, status) |
| POST | `/api/users/:id/reset-password` | Admin | Reset a user's password |
| GET, POST | `/api/students` | Warden, Admin | Student records |
| GET, POST | `/api/rooms` | Bearer (POST: Admin) | Rooms and beds |
| GET, POST | `/api/applications` | Bearer | Room applications and waiting list |
| GET, POST | `/api/inspections` | Bearer | Check-in and check-out inspections |
| GET, POST | `/api/damages` | Bearer | Damage reports |
| GET, POST | `/api/fines` | Bearer | Fines, appeals and payment |
| GET, POST | `/api/fees` | Bearer | Invoices, with `/api/payments` and `/api/deposits` |
| GET, POST | `/api/repairs` | Bearer | Repair requests |
| GET, POST | `/api/maintenance` | Bearer | Maintenance jobs |
| GET, POST | `/api/m/:module` | Bearer | Visitors, leave, transfers, complaints, notices, keys, incidents, lost and found |
| GET | `/api/reports` | Admin, Management | Reports (PDF and Excel download) |
| GET | `/api/dashboard` | Bearer | Dashboard numbers for the signed-in role |

Validation: username required, password minimum 8 characters with letters and numbers.

## Frontend (plain HTML, CSS and JavaScript)

No build step and no separate server. The backend serves the `frontend` folder, so after
`npm run dev` open **http://localhost:3000** and sign in.

```
hostel-management-system/
├─ backend/     server.js, db.js, migrations/, lib/, routes/, scripts/, tests/
├─ database/    schema.sql (optional, same tables as the migrations)
└─ frontend/    index.html, css/, js/core/, js/pages/
```

## Environment settings (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and fill it in. Never commit `.env`.

| Setting | Needed | What it does |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Yes | PostgreSQL connection |
| `JWT_SECRET` | Yes | Secret that signs login tokens. At least 32 random characters. Production refuses to start without it |
| `TOKEN_HOURS` | No | How long a login lasts (default 8) |
| `JWT_ISSUER`, `JWT_AUDIENCE` | No | Names stored inside each token (defaults are fine) |
| `PORT` | No | Server port (default 3000) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` | No | First administrator, created on first start. Must change the password at first sign-in |
| `ALLOW_STUDENT_SIGNUP` | No | `false` turns off student self sign-up |
| `NODE_ENV` | No | Set to `production` on a real server |

Make a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Login security (JWT)

- Login returns a standard JWT (HS256) with issuer, audience, issued-at, not-before, expiry and a unique id.
- Tokens signed with another algorithm (including `none`), changed tokens, expired tokens and tokens for another issuer or audience are rejected.
- Changing or resetting a password signs that user out everywhere.
- Signing out cancels that exact token straight away (the list of cancelled tokens is kept in memory, so it resets when the server restarts).
- The token is stored in the browser, so keep the site on HTTPS in production.
- After updating from an older version, everyone signs in once more.

## Using the app

**Home screen.** Each role sees big buttons for what it does most. A red number on a button means something is waiting there. Staff can open "See all numbers and charts" for the full statistics.

| Role | Home buttons |
|---|---|
| Student | Report a problem, My room, Fees & deposit, My fines, Ask for leave, Register a visitor, Notices |
| Warden | Check a room, Report damage, Room requests, Approve visitors, Approve leave, Answer messages, Find a student |
| Administrator | Review damage, Room requests, Fines, Fees & payments, Students, Accounts, Reports |
| Management | Reports, Damage, Fees & payments, Fines, Maintenance, Rooms |
| Maintenance | My repair jobs, Maintenance jobs, Alerts |
| Security | Visitors, Students returning, Report an incident, Room keys, Lost & found |

**Menu.**
- Phone: a bottom bar with four tabs and "More" for every other page. "More" lights up when you are on a page without a tab.
- Desktop: use the arrow button at the top of the menu to expand it (page names) or shrink it (icons). The choice is remembered. The page you open is always scrolled into view and highlighted.
- Filter chips (Fines, Rooms and others) are one swipeable row on a phone.

**Passwords.** Every password box has an eye button to show or hide what you typed.

## Notes on this version

- The Electricity & water page was removed. The `utility_readings` table is still in the database and holds no new data. To remove it, add a new migration with `DROP TABLE utility_readings;` (never edit an old migration).
- No new packages were added. JWT is written with Node's built-in `crypto` (`backend/lib/jwt.js`).
- JWT tests: `backend/tests/00-jwt.test.js`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Server stops with "Set JWT_SECRET" | Put a random 32+ character `JWT_SECRET` in `backend/.env` |
| "Please sign in" right after updating | Expected once: old tokens are not accepted. Sign in again |
| Signed out every time the server restarts | `JWT_SECRET` is empty, so a new one is made each start. Set it |
| Cannot connect to the database | Check the `DB_*` settings and that PostgreSQL is running. Open `/api/health` |
| `npm test` fails to connect | Create the test database once: `createdb hostel_management_test` |
