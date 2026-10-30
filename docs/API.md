# REST API reference

Base path `/api`. All endpoints except `/health` and `/auth/*` require `Authorization: Bearer <accessToken>`.
Errors are JSON `{ "error": "message", "details"?: [...] }` with 400 (validation / business rule), 401, 403, 404, 409 or 500.
List endpoints accept `page` and `pageSize` and return `{ items, total, page, pageSize }`.
"Scope" = EXEC sees own data, MANAGER sees self + direct reports, ADMIN sees everything.

## Auth
| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/auth/otp/request` | `{ mobile }` | Sends OTP by SMS + WhatsApp. Same response for unknown numbers. `devOtp` only when `OTP_DEV_ECHO=true`. Rate-limited. |
| POST | `/auth/otp/verify` | `{ mobile, otp }` | → `{ accessToken, refreshToken, user }`. Max attempts enforced. |
| POST | `/auth/refresh` | `{ refreshToken }` | Rotates the refresh token. |
| POST | `/auth/logout` | `{ refreshToken }` | Revokes the refresh token. |
| GET | `/auth/me` | | Current user profile. |

## Attendance
| Method | Path | Notes |
|---|---|---|
| GET | `/attendance/today` | Day state, open session, today's sessions |
| POST | `/attendance/face/challenge` | One-time selfie challenge for the signed-in employee → `{ challengeId, direction: LEFT|RIGHT, expiresInSeconds }`. 409 `details.code = PROFILE_PHOTO_MISSING` when no profile photo is registered; 429 after `FACE_MAX_ATTEMPTS_PER_15_MIN`. |
| POST | `/attendance/face/verify` | multipart `challengeId`, `front` (facing camera), `turned` (head turned to `direction`) — JPG/PNG/WEBP camera frames. Compared server-side with the Employee Master photo → `{ verificationId, status: PASSED|MISMATCH|NO_FACE|MULTIPLE_FACES|LIVENESS_FAILED, verified, message }`. A challenge can be submitted once (400 `CHALLENGE_INVALID` otherwise). |
| POST | `/attendance/start-day` | `{ verificationId, travelMode (OWN_VEHICLE/BUS/CAB/WALK), odoStart (own vehicle), lat, lng }`. Requires a PASSED, unused verification of the caller made within `FACE_VERIFICATION_VALID_SECONDS` against their current profile photo (400 `FACE_NOT_VERIFIED`). Marks late after `LATE_AFTER`. Opens a session. |
| POST | `/attendance/check-in` · `/attendance/check-out` | Header check-in/out sessions (one open session at a time) |
| GET | `/attendance/day-summary` | Visits, sales, GPS km for today |
| POST | `/attendance/end-day` | `{ odoEnd }` (own vehicle, ≥ start) — closes session and day |
| GET | `/attendance/calendar?year&month&userId` | Present/late/leave/absent per day, summary, leave & regularization lists |
| POST | `/attendance/regularizations` | `{ date (past), reason }` |
| POST | `/attendance/leaves` | `{ kind: LEAVE/PERMISSION, leaveType, fromDate, toDate, hours?, reason }` — today/future only, no overlap |
| GET | `/leaves?status` · `/regularizations?status` | Manager queues (scope) |
| POST | `/leaves/:id/approve|reject` · `/regularizations/:id/approve|reject` | `{ remark }` (required to reject) |

## Beats, journey plans, beat changes
| Method | Path | Notes |
|---|---|---|
| GET | `/beats` | Assigned beats with insights: A/B/C mix, month visits, NV/MV/V2… indicator, last-visit productive calls, priority group & reasons, planned days. `?scope=team` (manager), `?scope=all` (beat-change search), `?userId` |
| POST | `/beats/:id/visits` | `{ visited, ordered }` — manual "Log beat visit" (adds to today's counters) |
| GET | `/plans?year&month&userId` | Own plan is created on first access |
| GET | `/plans/pending` | Manager: pending plans with beat insights |
| GET | `/plans/:id` | Plan + beat insights |
| PUT | `/plans/:id/days` | `{ days: [{day, beatId}] }` — assigned beats only, no Sundays, one beat/day; locked while pending |
| POST | `/plans/:id/submit` | DRAFT/SENTBACK → PENDING, notifies manager |
| POST | `/plans/:id/approve` · `/plans/:id/send-back` | `{ note }` (required to send back) |
| POST | `/beat-changes` | `{ fromBeatId, toBeatId, forDate?, remarks }` |
| GET | `/beat-changes?status&withInsights=true` | Own (exec) / team (manager) |
| POST | `/beat-changes/:id/approve|reject` | Approval moves that day of the plan to the new beat |

## Outlets, visits, payments
| Method | Path | Notes |
|---|---|---|
| GET | `/outlets?beatId&search&sort=distance|name|outstanding&lat&lng` | Approved outlets in visible beats with outstanding, credit limit, last-month sales, performance flag, distance, visited-today |
| GET | `/outlets/:id` | + documents, recent payments |
| POST | `/outlets` | multipart: fields + `shopPhoto`, `gstinPhotos[≤5]`, `panPhotos[≤5]`, GPS. GSTIN/PAN format and cross-check, duplicate mobile/GSTIN check. EXEC → PENDING |
| GET | `/outlets/pending` | Manager approval queue with documents |
| POST | `/outlets/:id/approve|reject` | `{ remark, outletClass?, creditLimit? }` |
| POST | `/outlets/:id/visits` | No-order remark `{ reason, notes?, lat?, lng? }` → updates beat visit counters, geofence distance |
| GET | `/outlets/:id/payments` | Total due, collected, balance, history |
| POST | `/payments` | `{ outletId, amount ≤ balance, method CASH/UPI/CHEQUE, reference (UPI/cheque) }` → receipt |

## Products and orders
| Method | Path | Notes |
|---|---|---|
| GET | `/products?tab&search` | Tabs: All, Frequently (ordered by me in 90 days), Offer, New Launch, Must Selling |
| GET | `/products/by-qr/:code` | Product QR lookup |
| GET | `/products/matrix?ids=1,2` | Colours × sizes with stock status per cell |
| POST | `/orders/quote` | `{ outletId, lines[], paymentTerms }` → server pricing (full/half sleeve), scheme free goods, MOQ, stopped-cell check, tax, credit-limit check |
| POST | `/orders` | Quote fields + `clientRef` (idempotency), `instructions`, `signature` (PNG data URL), `transport {mode, transporter, destination, deliveryDate}`, `lat/lng`. One transaction: order, lines, status log, outlet & beat visit; credit-hold + manager notification when over limit |
| GET | `/orders?status&search&userId&outletId&from&to` | Scope; includes `statusCounts` and `totalAmount` |
| GET | `/orders/:id` | Lines grouped by product, status timeline |
| POST | `/orders/:id/advance` | Manager/admin (or ERP service account): next status RECEIVED → APPROVED → DELIVERED → INVOICED → DISPATCHED → COMPLETED, stamps time, invoice/LR numbers |

## Field work
| Method | Path | Notes |
|---|---|---|
| GET | `/work-logs/today` · `/work-logs/colleagues` | |
| POST | `/work-logs` | `{ type: DISTRIBUTOR/OFFICE/MEETING/JOINED, place, joinedUserId, notes, lat, lng }` |
| POST | `/work-logs/:id/checkout` | |
| GET | `/surveys/sections` · `/surveys?outletId` | |
| POST | `/surveys` | `{ outletId, answers: { SECTION_CODE: text } }` |
| GET | `/expenses/types` · `/expenses?year&month&userId` · `/expenses?status=PENDING` (manager) | |
| POST | `/expenses` | multipart `date (not future), type, amount, notes?, bill` — limit snapshot, over-limit flag |
| POST | `/expenses/:id/approve|reject` | |

## Targets, tracking, dashboards, reports
| Method | Path | Notes |
|---|---|---|
| GET | `/targets?userId` | Monthly/daily/weekly/quarterly target vs achievement, incentive slab & earnings |
| PUT | `/targets` | Manager: `{ userId, year, month, monthlyTarget, workingDays }` |
| POST | `/tracking/points` | `{ lat, lng, label? }` |
| GET | `/tracking/today?userId` | Points, visits, distance, active minutes, deviations, pending outlets |
| GET | `/tracking/team` | Manager: last position and active/idle per member |
| GET | `/dashboard/exec` | Today's beat, sales vs average, outstanding, target, recent orders, pending sample pads |
| GET | `/dashboard/manager` | Team sales & trend, target %, active now, pending approvals, beat-change trend (unusual flag), ranking, beat visit status, sample-pad summary |
| GET | `/team` | Ranking + today's attendance |
| GET | `/approvals/summary` · `/approvals/recent` | Badge counts, recently actioned |
| GET | `/reports/sales-trend?days&scope=team&userId` | Daily sales + change vs previous period |
| GET | `/reports/beat-coverage?userId` | Outlets visited this month per beat |
| GET | `/reports/team-summary` | Beat-change trend vs last month, attendance summary |
| GET | `/reports/export?type=orders|expenses|attendance|team&from&to` | CSV (formula-injection safe) |

## Sample pads and notifications
| Method | Path | Notes |
|---|---|---|
| GET | `/sample-pads?userId` | Own pads grouped by DC with QR payload `SP|EmpID|DC|Item` |
| POST | `/sample-pads/:id/acknowledge` | `{ code, via: QR_SCAN/PHOTO_SCAN }` — owner only, exact QR only, cannot be reverted |
| GET | `/sample-pads/records?userId&status=ack|pen&search` | Manager: Sample Pad object rows + KPIs |
| PUT | `/sample-pads/:id/remarks` | `{ remarks }` |
| POST | `/sample-pads/remind` | `{ ids }` — stamps reminder date, notifies each executive |
| POST | `/sample-pads/challans` | `{ dcNo, dcDate, userId, items[] }` — issue pads on a delivery challan |
| GET | `/notifications` · POST `/notifications/:id/read` · POST `/notifications/read-all` | |

## Administration (ADMIN)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/admin/users` · PUT `/admin/users/:id` | Users, roles, reporting manager, active flag (deactivation revokes sessions) |
| PUT | `/admin/users/:id/beats` | `{ beatIds }` |
| POST · GET | `/admin/users/:id/photo` | Employee profile photo for attendance face verification: multipart `photo` (must show exactly one face; replaces the previous photo and face template) · GET streams it (`no-store`). Stored under `SECURE_UPLOAD_DIR`, never public. |
| GET/POST | `/admin/beats` | |
