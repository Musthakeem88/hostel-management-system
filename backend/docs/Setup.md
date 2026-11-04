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
