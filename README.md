# Marketing Management Application

Sales-executive and field-force platform built from the *FieldForce Pro* HTML prototype (renamed throughout).
Field executives plan beats, mark attendance, visit outlets, take orders on a colour × size matrix, collect payments,
run market surveys, file expenses and acknowledge sample pads by QR. Managers approve plans and requests,
track the team live and monitor targets, beat coverage and sample-pad acknowledgement.

| Layer    | Technology |
|----------|------------|
| Frontend | Angular 22 (standalone components, signals, zoneless), SCSS |
| Backend  | Node.js 20+ · Express 5 · `mssql` (tedious) · JWT · Zod validation · Pino logging |
| Database | Microsoft SQL Server 2017+ (uses `OPENJSON`, `CREATE OR ALTER`, sequences, filtered indexes) |

```
├── backend/                 REST API
│   ├── src/
│   │   ├── app.js           Express app (security headers, CORS, routes, errors)
│   │   ├── server.js        HTTP server + graceful shutdown
│   │   ├── config/env.js    All configuration from environment variables
│   │   ├── db/index.js      Connection pool, parameterised query/exec/transaction helpers
│   │   ├── domain/rules.js  Pure business rules (visit indicator, priority, pricing, KYC, …)
│   │   ├── middleware/      auth (JWT, roles, team scope), uploads, error mapping
│   │   ├── services/        beat insights, targets, approvals, notifications
│   │   └── modules/         one router per functional area
│   ├── scripts/             create-db · migrate · seed
│   └── test/                node:test suites (rules, API, SQL static checks)
├── database/
│   ├── migrations/          001 schema · 002 views & stored procedures · 003 reference data
│   └── seed/demo_seed.sql   optional demo data (dates relative to today)
├── frontend/                Angular app (src/app/core · shared · features/*)
└── docs/                    API reference, prototype analysis
```

## 1. Prerequisites

* Node.js 20 or newer (developed on Node 24) and npm
* SQL Server 2017+ (Express, Developer or Azure SQL) reachable over TCP, with a login that can create a database
  (or an existing empty database and a login with `db_owner` on it)

## 2. Database setup

```bash
cd backend
npm install
cp .env.example .env          # Windows: copy .env.example .env  — then edit DB_* and JWT_SECRET
npm run db:create             # creates DB_NAME if missing (needs CREATE DATABASE permission)
npm run db:migrate            # applies database/migrations/*.sql once each (tracked in dbo.SchemaMigrations)
npm run db:seed               # optional: loads demo users, beats, outlets, orders, sample pads
# or all three: npm run db:setup
```

Migrations can also be run manually with `sqlcmd -S <server> -d <db> -i database/migrations/001_schema.sql` (in order).
New schema changes go in a new numbered file (`004_….sql`); applied files are never edited.

## 3. Configuration (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default 3000) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |
| `DB_SERVER`, `DB_PORT`, `DB_INSTANCE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | SQL Server connection |
| `DB_ENCRYPT`, `DB_TRUST_SERVER_CERT` | TLS settings (use `DB_ENCRYPT=true` for Azure SQL) |
| `JWT_SECRET` | ≥ 32 random characters — the server refuses to start otherwise |
| `JWT_EXPIRES_IN`, `REFRESH_TOKEN_DAYS` | Access-token lifetime and refresh-token lifetime |
| `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS` | OTP validity and wrong-attempt limit |
| `OTP_DEV_ECHO` | `true` returns the OTP in the API response (development only; refused in production) |
| `SMS_GATEWAY_URL`, `SMS_GATEWAY_TOKEN` | Gateway that delivers the OTP over SMS + WhatsApp (OTPs are logged when blank) |
| `APP_TIMEZONE`, `LATE_AFTER` | Business time zone and late check-in cut-off (default Asia/Kolkata, 10:00) |
| `TAX_RATE`, `GEOFENCE_METERS` | Order tax rate and outlet geofence radius |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | Where shop/KYC photos, bills and signatures are stored (served publicly under random names) |
| `SECURE_UPLOAD_DIR` | Employee profile photos and attendance selfies (biometric) — never served statically; back it up and restrict OS access |
| `FACE_MATCH_THRESHOLD`, `FACE_LIVENESS_MIN_TURN`, `FACE_CHALLENGE_SECONDS`, `FACE_VERIFICATION_VALID_SECONDS`, `FACE_MAX_ATTEMPTS_PER_15_MIN` | Selfie attendance face verification (see `.env.example`) |

The frontend calls the API at `/api` (same origin). In development `frontend/proxy.conf.json` forwards `/api` and
`/uploads` to `http://localhost:3000`; change `src/environments/environment.prod.ts` if the API is hosted elsewhere.

## 4. Run in development

```bash
# terminal 1
cd backend && npm run dev          # http://localhost:3000  (GET /api/health)
# terminal 2
cd frontend && npm install && npm start   # http://localhost:4200
```

### Demo logins (after `npm run db:seed`, with `OTP_DEV_ECHO=true` the OTP is filled in for you)

| Role | Mobile | Name |
|------|--------|------|
| Sales Executive | 9880100210 | Ravi Kumar (FA-2231) |
| Sales Executive | 9880100240 / 9880100255 / 9880100261 / 9880100277 | Suresh M / Anil Pawar / Deepa R / Karan S |
| Manager | 9880100001 | Priya K. (Area Sales Manager) |
| Admin | 9000000001 | System Admin |

Camera features (selfie, QR scanning) need HTTPS or `localhost`.

**Selfie attendance:** an admin uploads each employee's profile photo in *Users & Beats* (Employee Master). On *Start Your Day*
the employee captures a live selfie with the front camera (no gallery/file option): one frame facing the camera, one with the
head turned to a server-chosen side. The API compares it with the profile photo on this server (face-api.js models,
TensorFlow WASM — no third-party service) and only a passed, single-use verification can start the day. The head-turn check
defeats a still printed photo; it is not certified liveness and will not stop a well-made video replay.
 Non-production builds also show a
"Simulate scan (demo)" button in the QR scanner; production builds do not.

## 5. Roles and permissions

Enforced in the API (`authorize()` + team scoping in every query); the Angular route guards mirror them.

| Capability | EXEC | MANAGER | ADMIN |
|------------|:---:|:---:|:---:|
| Attendance, start/end day, leave & regularization requests | ✔ | | |
| Journey plan, beat change request, log beat visit | ✔ | | |
| Outlet visits, orders, payments, surveys, expenses, sample-pad acknowledgement | ✔ | | |
| New outlet | ✔ (pending approval) | ✔ (auto-approved, team beats) | ✔ |
| View orders / outlets / reports | own | own team | everyone |
| Approve plans, beat changes, expenses, outlets, leave, regularization, credit-hold orders | | team only, never own | ✔ |
| Advance order status, set targets, sample-pad remarks/reminders, issue pads on DC | | team | ✔ |
| Users, roles, reporting lines, beat assignment, beats | | | ✔ |

## 6. Tests

```bash
cd backend  && npm test                     # 29 tests: business rules, API (auth, roles, scoping, validation,
                                            # pricing, QR acknowledgement, error mapping, CSV), SQL static checks
cd frontend && npx ng test --watch=false    # 15 tests: format helpers, order cart store, beat list, guards
cd frontend && npx ng build                 # production build with strict template type-checking
```

The API tests run the real Express app against a scripted stand-in for the data layer, so they need no database.
**Run the full flow against a real SQL Server before go-live** (see §8): the T-SQL was written and reviewed for
SQL Server 2017+ but could not be executed in the environment this was built in.

## 7. Build and deploy

1. **Database** – run `npm run db:migrate` against the production database (seed only for demos).
2. **API**
   ```bash
   cd backend && npm ci --omit=dev
   NODE_ENV=production node src/server.js     # or a process manager: pm2 start src/server.js --name mma-api
   ```
   On Windows run it as a service (e.g. NSSM or `pm2-windows-service`). Set `NODE_ENV=production`,
   `OTP_DEV_ECHO=false`, a real `JWT_SECRET`, SMS gateway settings and `CORS_ORIGINS`.
   Keep `UPLOAD_DIR` on persistent storage and include it in backups.
3. **Frontend**
   ```bash
   cd frontend && npm ci && npx ng build      # output: frontend/dist/frontend/browser
   ```
   Serve `dist/frontend/browser` from Nginx / IIS / any static host with SPA fallback to `index.html`, and
   reverse-proxy `/api` and `/uploads` to the Node server, e.g. for Nginx:
   ```nginx
   location /api/     { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $remote_addr; client_max_body_size 40m; }
   location /uploads/ { proxy_pass http://127.0.0.1:3000; }
   location /         { root /var/www/mma; try_files $uri /index.html; }
   ```
   Serve over HTTPS — camera and geolocation require a secure origin.
4. **Health check** – `GET /api/health` returns 200 when the database is reachable, 503 otherwise.

## 8. Go-live checklist

- [ ] `npm run db:migrate` succeeds on the target SQL Server; `npm run db:seed` on a scratch DB, then log in as each demo role
- [ ] Walk the main flows end to end: start day → visit → order (matrix → summary → transport) → order status; plan → submit → manager approve; beat change; new outlet → approve; expense → approve; sample pad QR acknowledgement → Sample Pad object
- [ ] SMS/WhatsApp gateway delivers OTPs; `OTP_DEV_ECHO=false`
- [ ] Order status updates (`POST /api/orders/:id/advance`) wired to ERP/DMS events if required
- [ ] Backups for the database and `UPLOAD_DIR`

## 9. Notes and limitations

* Uploaded images are served from `/uploads` with unguessable 24-byte random names (needed so `<img>` tags can load
  them without a bearer token). Move them behind signed URLs if the files must never be reachable by link.
* Reports export as CSV (opens directly in Excel). PDF export is not implemented.
* Stock levels, invoices and dispatch numbers are maintained in the database; integrating a live ERP/DMS feed
  is outside this codebase (the order-advance endpoint and `StockLevels` table are the integration points).
* The tracking map is a schematic projection of GPS points (no map tiles), as in the prototype.

See `docs/API.md` for every endpoint and `docs/PROTOTYPE_ANALYSIS.md` for how each prototype screen and rule maps to the implementation.
