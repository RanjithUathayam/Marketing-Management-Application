# Prototype analysis and implementation map

Source: `fieldforce-pro (4).html` — a single-page phone mock with an executive / manager role switch, an embedded
"Order Matrix v4 + Sample Pad" sub-app, a Salesforce "Sample Pad object" panel and two BRD tables
(Beat Classification & Visit Management; Sample Pad Issuance & Acknowledgement). All sample data was hard-coded.

The product is renamed **Marketing Management Application**. The prototype's demo-only scaffolding
(role switch, phone frame, notch, right-hand module panel, "cycle location" button, simulated scans in production)
is replaced by real authentication, an app frame that is responsive on phones and desktops, and live data.

## Screens → routes

| Prototype screen | Route / component | Backed by |
|---|---|---|
| Login (OTP via SMS/WhatsApp) | `/login` `LoginPage` | `/auth/otp/*` |
| Start day (selfie, travel type, odometer) + success sheet | `/start-day` | `/attendance/start-day` |
| Apply leave / permission | `LeaveSheet` (start day, attendance) | `/attendance/leaves` |
| Home dashboard (header check-in/out timer, today's beat, sample-pad alert, KPIs, target, quick actions, recent orders) | `/home` | `/dashboard/exec`, `/attendance/*` |
| Attendance calendar, regularization, leave status | `/attendance` | `/attendance/calendar`, `/attendance/regularizations` |
| Work type (retailer / joined / distributor / office / meeting) | `/work` | `/work-logs` |
| Distributor / office check-in & out | `/work/check/:type` | `/work-logs/:id/checkout` |
| Route: my plan, assigned beats (filter All/NV/MV/Vs, priority groups, expand), log visit, beat change | `/route` | `/plans`, `/beats`, `/beat-changes` |
| Build plan, review & submit, approval status timeline | `/route/build`, `/route/review`, `/route/status` | `/plans/:id/days`, `/plans/:id/submit` |
| Outlet list (nearest first, performance colours), outlet task sheet, no-order remark | `/outlets` | `/outlets`, `/outlets/:id/visits` |
| New outlet (shop photo, GSTIN/PAN + ≤5 photos each, address, GPS) | `/outlets/new` | `POST /outlets` |
| Take order: tabs, search, QR scan, Quick Pick brand → category, Sample Pad tab | `/order` | `/products`, `/products/by-qr`, `/sample-pads` |
| Order matrix: sleeves, colour search, core/non-core, stock strip & legend tallies, keypad, all-sizes mode, scheme nudge, MOQ, stock indicator & same-price alternate (↺ Use / ✓ Alter), live totals | `/order/matrix` | `/products/matrix` |
| Order summary (scheme benefit, credit-limit check, payment terms, signature) | `/order/summary` | `/orders/quote` |
| Transport (same as last visit, mode, transporter, destination, immediate/custom date) | `/order/transport` | `POST /orders` |
| Order placed (time taken, WhatsApp share) | `/order/success/:id` | `/orders/:id` |
| Order Status tab (KPIs, search, status chips, mini tracker) and detail (animated steps, timeline with timestamps, items) | `/orders`, `/orders/:id` | `/orders`, `/orders/:id/advance` |
| Market survey (7 sections) | `/survey/:outletId` | `/surveys` |
| Payment collection (due/collected/balance, method, receipt, history, reminder) | `/payment/:outletId` | `/outlets/:id/payments`, `/payments` |
| Expenses (limits, bill proof, over-limit flag, status) | `/expenses` | `/expenses` |
| Live tracking (map, route history, geofence, deviation) | `/tracking` | `/tracking/today` |
| Targets & incentives (period breakdown, slabs, earnings) | `/targets` | `/targets` |
| Reports (sales bars, beat coverage, export) | `/reports` | `/reports/*` |
| Notifications | `/notifications` | `/notifications` |
| Profile (end day with odometer) | `/profile` | `/attendance/end-day` |
| Customers / products masters | `/customers`, `/products` | `/outlets`, `/products` |
| Sample pads (DC-grouped, QR sheet, camera / photo scan) | `/sample-pads` | `/sample-pads/*` |
| Manager overview (KPIs, beat-change trend, performance, sample-pad acknowledgement, beat visit status) | `/manager` | `/dashboard/manager` |
| Team ranking & attendance | `/manager/team` | `/team`, `PUT /targets` |
| Approvals inbox + review sheets (with beat insights on beat changes) | `/manager/approvals` | approve/reject endpoints |
| Journey plan review (calendar, beat insights, approve / send back) | `/manager/plans/:id` | `/plans/:id/*` |
| Live team tracking | `/manager/track` | `/tracking/team` |
| Team reports | `/manager/reports` | `/reports/*` |
| Salesforce Sample Pad object (filters, KPIs, remarks, reminders) + issue on DC | `/manager/sample-pads` | `/sample-pads/records`, `/remarks`, `/remind`, `/challans` |
| *(new)* User, role and beat administration | `/admin/users` | `/admin/*` |

## Business rules implemented (server-side, `backend/src/domain/rules.js` unless noted)

* **Monthly visit indicator** NV (0) · MV (1) · V2 · V3 · V4+, counted per calendar month from `BeatVisits`; history kept.
  Visits update automatically when an outlet is visited (order or no-order remark — `usp_RecordOutletVisit`) or via "Log visit".
* **Productive calls** = dealers ordered ÷ dealers visited on the last visit: ≥70 % high selling, 40–69 % average, <40 % low (warning text).
* **Priority**: Not Visited → Must Visit (planned today, ≥7 days since last visit, or low calls) → On Track; A-class count breaks ties.
* **Outlet classes** A/B/C mix per beat (`vw_BeatSummary`).
* **Outlet performance** colours: high outstanding (≥80 % of credit), no order in 30 days, ordered in 7 days, on track.
* **Journey plan**: one beat per working day, Sundays off, assigned beats only, locked while pending, edits reset to draft.
* **Beat change**: remarks required, approval re-points that day in the plan.
* **Order pricing**: full-sleeve = FR, half-sleeve = round(FR × 0.92); stopped cells rejected; MOQ per product;
  "Buy 10 Get 1" free goods; 5 % tax; credit check against outstanding + order (credit terms) → credit hold & manager approval;
  idempotent submission by `clientRef`.
* **Order lifecycle** six stages, each stamped in `OrderStatusLog`.
* **Payments** cannot exceed the outstanding balance; receipts numbered from a sequence.
* **Expenses**: per-type limit snapshot, bill required, over-limit flagged to the manager.
* **Attendance**: late after 10:00 local time; one open session; odometer end ≥ start; leave only for today/future.
* **Incentive slabs** <80 % 0 %, 80–100 % 1.2 %, 100–120 % 2 %, >120 % 2.8 % (`IncentiveSlabs` table).
* **KYC**: GSTIN format + state code, PAN format, PAN must match GSTIN, state must match GSTIN, ≤5 photos each.
* **Sample pads**: QR `SP|EmpID|DC|Item`; only the owner and only the matching QR can acknowledge; irreversible; reminders stamped.
* **Approvals**: managers act only on their direct reports and never on their own requests; rejecting needs remarks.

## Entities → tables (`database/migrations/001_schema.sql`)

Users, Roles, OtpCodes, RefreshTokens · Beats, BeatAssignments, BeatVisits · Outlets, OutletDocuments, OutletVisits ·
AttendanceDays, AttendanceSessions, LeaveRequests, Regularizations, WorkLogs · JourneyPlans, JourneyPlanDays,
BeatChangeRequests · Products, ProductColors, Sizes, StockLevels · Orders, OrderLines, OrderStatusLog, OrderStatuses ·
Payments · SurveySections, Surveys, SurveyAnswers · ExpenseTypes, Expenses · SalesTargets, IncentiveSlabs ·
GpsPoints, Notifications · DeliveryChallans, SamplePads. Views: `vw_OutletBalance`, `vw_BeatSummary`.
Procedures: `usp_RecordOutletVisit`, `usp_LogBeatVisit`, `usp_AdvanceOrderStatus`, `usp_SaveJourneyPlanDays`.

## Deliberate differences from the prototype

* Order status changes come from managers / ERP (`POST /orders/:id/advance`), not from a "demo: move to next" button for executives.
* "Simulate scan (demo)" exists only in non-production builds.
* Stock statuses are stored per colour × size instead of being derived from a hash.
* Outlets with GSTIN/PAN are validated against the same rules on the server, not only in the browser.
