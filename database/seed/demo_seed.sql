/* ═══════════════════════════════════════════════════════════════════════
   Demo data for Marketing Management Application.
   Dates are relative to the day the script runs so dashboards show
   current-month activity. Safe to run once on an empty database
   (after migrations). Login = mobile number + OTP (OTP is echoed in
   development when OTP_DEV_ECHO=true).
   ═══════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON; SET XACT_ABORT ON;
IF EXISTS (SELECT 1 FROM dbo.Users) THROW 50100, 'Demo seed expects an empty database', 1;

BEGIN TRAN;

DECLARE @today DATE = CAST(SYSUTCDATETIME() AS DATE);
DECLARE @ms DATE = DATEFROMPARTS(YEAR(@today), MONTH(@today), 1);
DECLARE @lastMs DATE = DATEADD(MONTH, -1, @ms);
DECLARE @dom INT = DAY(@today);

/* ── Users ── */
SET IDENTITY_INSERT dbo.Users ON;
INSERT dbo.Users (UserId, EmpCode, FullName, Mobile, Email, RoleCode, Designation, Region, Territory, ManagerId) VALUES
 (1,'ADM-0001',N'System Admin','9000000001',N'admin@example.com','ADMIN',N'Sales Operations Admin',N'All India',NULL,NULL),
 (2,'MGR-1001',N'Priya K.',  '9880100001',N'priya.k@example.com','MANAGER',N'Area Sales Manager',N'Bengaluru South',NULL,NULL),
 (3,'FA-2231', N'Ravi Kumar','9880100210',N'ravi.kumar@example.com','EXEC',N'DSR',N'Bengaluru South',N'Koramangala',2),
 (4,'FA-2240', N'Suresh M',  '9880100240',NULL,'EXEC',N'DSR',N'Bengaluru South',N'Indiranagar',2),
 (5,'FA-2255', N'Anil Pawar','9880100255',NULL,'EXEC',N'DSR',N'Bengaluru South',N'Domlur',2),
 (6,'FA-2261', N'Deepa R',   '9880100261',NULL,'EXEC',N'DSR',N'Bengaluru South',N'BTM Layout',2),
 (7,'FA-2277', N'Karan S',   '9880100277',NULL,'EXEC',N'DSR',N'Bengaluru South',N'JP Nagar',2);
SET IDENTITY_INSERT dbo.Users OFF;

/* ── Beats ── */
SET IDENTITY_INSERT dbo.Beats ON;
INSERT dbo.Beats (BeatId, BeatCode, BeatName, Area, ColorTag) VALUES
 (1,'BT-007',N'Koramangala 4th Block',N'Koramangala','green'),
 (2,'BT-014',N'Indiranagar 100ft',    N'Indiranagar','teal'),
 (3,'BT-016',N'Domlur Inner Ring',    N'Domlur','amber'),
 (4,'BT-033',N'BTM 2nd Stage',        N'BTM Layout','green'),
 (5,'BT-058',N'Sony World Junction',  N'Koramangala','teal'),
 (6,'BT-009',N'JP Nagar Phase 5',     N'JP Nagar','amber');
SET IDENTITY_INSERT dbo.Beats OFF;

INSERT dbo.BeatAssignments (BeatId, UserId) VALUES
 (1,3),(2,3),(3,3),(4,3),(5,3),(6,3), (2,4),(5,4), (3,5),(4,5), (4,6),(1,6), (6,7),(5,7);

/* ── Outlets: six named outlets in BT-007, then generated outlets to the prototype's A/B/C mix ── */
SET IDENTITY_INSERT dbo.Outlets ON;
INSERT dbo.Outlets (OutletId, OutletName, OwnerName, Mobile, BeatId, OutletClass, Grade, CreditLimit, OpeningOutstanding,
                    AddressLine, City, District, StateName, PostalCode, Latitude, Longitude, ApprovalStatus, CreatedBy, ApprovedBy) VALUES
 (1,N'Sujal Fashion',  N'Sujal Shah','9880122114',1,'A',5,120000,0,    N'80 Feet Rd, 4th Block',N'Bengaluru',N'Bengaluru Urban',N'Karnataka','560034',12.935000,77.626000,'APPROVED',3,2),
 (2,N'Trendz Menswear',N'Ganesh R.', '9845577320',1,'A',4,100000,18500,N'5th Cross, 4th Block',N'Bengaluru',N'Bengaluru Urban',N'Karnataka','560034',12.934000,77.628000,'APPROVED',3,2),
 (3,N'Royal Textiles', N'Imran K.',  '9900155210',1,'B',3,80000,96500, N'1st Main, 4th Block', N'Bengaluru',N'Bengaluru Urban',N'Karnataka','560034',12.937000,77.622000,'APPROVED',3,2),
 (4,N'Fabindia Corner',N'Latha M.',  '9886241190',1,'A',4,90000,5200,  N'7th Main, 4th Block', N'Bengaluru',N'Bengaluru Urban',N'Karnataka','560034',12.939000,77.631000,'APPROVED',3,2),
 (5,N'Style Hub',      N'Vikas P.',  '9008033471',1,'C',2,60000,0,     N'6th Cross, 4th Block',N'Bengaluru',N'Bengaluru Urban',N'Karnataka','560034',12.941000,77.629000,'APPROVED',3,2),
 (6,N'The Wardrobe',   N'Ayesha N.', '9964088123',1,'A',5,150000,12000,N'100 Ft Rd, 4th Block',N'Bengaluru',N'Bengaluru Urban',N'Karnataka','560034',12.943000,77.618000,'APPROVED',3,2);
SET IDENTITY_INSERT dbo.Outlets OFF;

DECLARE @mix TABLE (BeatId INT, A INT, B INT, C INT, Area NVARCHAR(80), Pin CHAR(6), Lat DECIMAL(9,6), Lng DECIMAL(9,6));
INSERT @mix VALUES (1,8,2,2,N'Koramangala','560034',12.935,77.626),(2,5,4,3,N'Indiranagar','560038',12.971,77.641),
                   (3,4,6,4,N'Domlur','560071',12.961,77.638),(4,3,5,7,N'BTM Layout','560076',12.916,77.610),
                   (5,6,3,2,N'Koramangala','560095',12.937,77.627),(6,4,7,8,N'JP Nagar','560078',12.906,77.585);
DECLARE @pre TABLE (i INT, w NVARCHAR(20)); INSERT @pre VALUES (0,N'Sri'),(1,N'New'),(2,N'Classic'),(3,N'Elite'),(4,N'Metro'),(5,N'Star'),(6,N'Lucky'),(7,N'Prime'),(8,N'City'),(9,N'Galaxy');
DECLARE @suf TABLE (i INT, w NVARCHAR(20)); INSERT @suf VALUES (0,N'Fashions'),(1,N'Menswear'),(2,N'Garments'),(3,N'Collections'),(4,N'Trends'),(5,N'Textiles');

;WITH n AS (SELECT TOP (30) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn FROM sys.all_objects),
g AS (
  SELECT m.BeatId, m.Area, m.Pin, m.Lat, m.Lng, n.rn,
         CASE WHEN n.rn <= m.A THEN 'A' WHEN n.rn <= m.A + m.B THEN 'B' ELSE 'C' END AS Cls
  FROM @mix m JOIN n ON n.rn <= m.A + m.B + m.C)
INSERT dbo.Outlets (OutletName, OwnerName, Mobile, BeatId, OutletClass, Grade, CreditLimit, OpeningOutstanding,
                    AddressLine, City, District, StateName, PostalCode, Latitude, Longitude, ApprovalStatus, CreatedBy, ApprovedBy)
SELECT CONCAT(p.w, N' ', s.w, N' ', g.Area),
       CONCAT(N'Owner ', g.BeatId, N'-', g.rn),
       CONCAT('98', RIGHT(CONCAT('00000000', g.BeatId * 1000 + g.rn * 37), 8)),
       g.BeatId, g.Cls,
       CASE g.Cls WHEN 'A' THEN 5 - g.rn % 2 WHEN 'B' THEN 3 + g.rn % 2 ELSE 2 + g.rn % 2 END,
       CASE g.Cls WHEN 'A' THEN 120000 WHEN 'B' THEN 80000 ELSE 50000 END,
       (g.rn * 3700) % 40000,
       CONCAT(N'Shop ', g.rn, N', Main Road, ', g.Area), N'Bengaluru', N'Bengaluru Urban', N'Karnataka', g.Pin,
       g.Lat + g.rn * 0.0007, g.Lng + g.rn * 0.0005, 'APPROVED', 3, 2
FROM g JOIN @pre p ON p.i = (g.rn + g.BeatId) % 10 JOIN @suf s ON s.i = (g.rn * 7 + g.BeatId) % 6;

-- Pending new outlet created by Karan (manager approval queue)
INSERT dbo.Outlets (OutletName, OwnerName, Mobile, BeatId, OutletClass, Grade, CreditLimit, AddressLine, City, District, StateName, PostalCode, Latitude, Longitude, ApprovalStatus, CreatedBy)
VALUES (N'Fashion Point', N'Naveen T.', '9845012345', 6, 'C', 3, 0, N'24th Main, Phase 5', N'Bengaluru', N'Bengaluru Urban', N'Karnataka', '560078', 12.906500, 77.585900, 'PENDING', 7);

/* ── Products, colours, stock ── */
SET IDENTITY_INSERT dbo.Products ON;
INSERT dbo.Products (ProductId, ProductCode, QrCode, ProductName, Icon, Category, Brand, SubBrand, FactoryRate, Mrp, SchemeText, SchemeBuyQty, SchemeFreeQty, Moq, NonReturnable, Tag, HasSleeves) VALUES
 (1,'carlos','ARSR-0001',N'CARLOS',     N'👔','shirt',  N'Ariser',N'Shirt',  555,835,N'Buy 10 Get 1 Free',10,1,5,0,N'Must Selling',1),
 (2,'silk',  'ARSR-0002',N'SILK SATIN', N'🧣','fabric', N'Ariser',N'Fabric', 430,645,NULL,NULL,NULL,10,1,N'Offer',0),
 (3,'nexus', 'ARSR-0003',N'NEXUS DOBBY',N'🧵','fabric', N'Ariser',N'Fabric', 465,695,NULL,NULL,NULL,5,0,N'New Launch',0),
 (4,'kansas','ARSR-0004',N'KANSAS',     N'👖','trouser',N'Ariser',N'Trouser',670,995,N'Buy 10 Get 1 Free',10,1,5,0,N'Must Selling',0),
 (5,'afro',  'ARSR-0005',N'AFRO',       N'👕','shirt',  N'Ariser',N'Shirt',  630,945,NULL,NULL,NULL,5,0,N'Frequently',1),
 (6,'alto',  'ARSR-0006',N'ALTO',       N'🎽','shirt',  N'Ariser',N'Shirt',  555,835,NULL,NULL,NULL,5,0,N'New Launch',1);
SET IDENTITY_INSERT dbo.Products OFF;
UPDATE dbo.Products SET AltProductId = 6 WHERE ProductId = 1;
UPDATE dbo.Products SET AltProductId = 1 WHERE ProductId = 6;

INSERT dbo.ProductColors (ProductId, ColorCode, ColorName, HexValue) VALUES
 (1,'51006',N'Walnut','#795548'),(1,'51005',N'Sand','#c8a96e'),(1,'51003',N'Espresso','#4e342e'),
 (1,'51001',N'Navy Blue','#1a237e'),(1,'51002',N'Sky Blue','#0288d1'),(1,'51004',N'Forest Green','#2e7d32'),
 (2,'10912',N'Dull Pink','#e91e63'),(2,'10920',N'Cement Grey','#607d8b'),(2,'10921',N'Road Green','#2e7d32'),(2,'10909',N'Lavender','#7b1fa2'),
 (3,'20704',N'Pale Purple','#7c3aed'),(3,'20702',N'Pale Brown','#92400e'),(3,'20703',N'Steel Blue','#1e40af'),(3,'20701',N'White','#90a4ae'),
 (4,'K001',N'Black','#212121'),(4,'K002',N'Navy','#1a237e'),(4,'K003',N'Khaki','#a1887f'),
 (5,'A001',N'White','#90a4ae'),(5,'A002',N'Sky Blue','#0288d1'),(5,'A003',N'Peach','#e64a19'),
 (6,'L001',N'Mint','#10b981'),(6,'L002',N'Coral','#f43f5e'),(6,'L003',N'Sky','#3b82f6');
UPDATE dbo.ProductColors SET IsCore = CASE WHEN ABS(CHECKSUM(ColorCode)) % 2 = 0 THEN 1 ELSE 0 END;

-- Deterministic spread of stock statuses (≈10% stopped, 30% in stock, 20% OOS, 20% refill 13d, 20% refill 30d)
INSERT dbo.StockLevels (ColorId, SizeCode, QtyOnHand, StockStatus)
SELECT c.ColorId, s.SizeCode,
       CASE WHEN x.r BETWEEN 1 AND 3 THEN 20 + x.r * 9 ELSE 0 END,
       CASE WHEN x.r = 0 THEN 'STOPPED' WHEN x.r <= 3 THEN 'IN_STOCK' WHEN x.r <= 5 THEN 'OOS_15' WHEN x.r <= 7 THEN 'REFILL_13' ELSE 'REFILL_30' END
FROM dbo.ProductColors c
JOIN dbo.Products p ON p.ProductId = c.ProductId
CROSS JOIN dbo.Sizes s
CROSS APPLY (SELECT ABS(CHECKSUM(p.ProductCode + c.ColorCode + s.SizeCode)) % 10 AS r) x;
-- AFRO is fully out of stock, as in the prototype
UPDATE sl SET StockStatus = 'OOS_15', QtyOnHand = 0
FROM dbo.StockLevels sl JOIN dbo.ProductColors c ON c.ColorId = sl.ColorId WHERE c.ProductId = 5;

/* ── Targets ── */
INSERT dbo.SalesTargets (UserId, TargetYear, TargetMonth, MonthlyTarget, WorkingDays)
SELECT u.UserId, YEAR(@today), MONTH(@today), t.Amt, 26
FROM dbo.Users u JOIN (VALUES (3,1500000),(4,1475000),(5,1320000),(6,1360000),(7,1380000)) t(UserId, Amt) ON t.UserId = u.UserId;

/* ── Orders: deterministic history for this month and last month ── */
DECLARE @o TABLE (UserId INT, OutletId INT, OrderedAt DATETIME2(0), Terms VARCHAR(10), Status VARCHAR(12), Seed INT);
;WITH d AS (SELECT TOP (60) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS k FROM sys.all_objects),
ex AS (SELECT UserId FROM dbo.Users WHERE RoleCode = 'EXEC')
INSERT @o (UserId, OutletId, OrderedAt, Terms, Status, Seed)
SELECT ex.UserId,
       ol.OutletId,
       DATEADD(MINUTE, 600 + (d.k * 47) % 420, CAST(DATEADD(DAY, -d.k, @today) AS DATETIME2(0))),
       CASE WHEN d.k % 5 = 0 THEN 'CASH' ELSE 'CREDIT' END,
       CASE WHEN d.k = 0 THEN 'RECEIVED' WHEN d.k = 1 THEN 'APPROVED' WHEN d.k = 2 THEN 'DELIVERED'
            WHEN d.k <= 4 THEN 'INVOICED' WHEN d.k <= 6 THEN 'DISPATCHED' ELSE 'COMPLETED' END,
       ex.UserId * 100 + d.k
FROM ex
JOIN d ON d.k % 2 = ex.UserId % 2 AND d.k <= @dom + 28           -- every other day, back into last month
CROSS APPLY (
  -- OFFSET cannot reference outer columns, so pick the n-th assigned outlet with ROW_NUMBER()
  SELECT z.OutletId FROM (
    SELECT o.OutletId, ROW_NUMBER() OVER (ORDER BY o.OutletId) AS rn, COUNT(*) OVER () AS cnt
    FROM dbo.Outlets o JOIN dbo.BeatAssignments ba ON ba.BeatId = o.BeatId AND ba.UserId = ex.UserId
    WHERE o.ApprovalStatus = 'APPROVED') z
  WHERE z.rn = 1 + (ex.UserId * 3 + d.k) % z.cnt) ol;

INSERT dbo.Orders (OrderNo, OutletId, UserId, OrderedAt, SubTotal, MrpValue, TaxAmount, TotalAmount, TotalPieces, PaymentTerms,
                   TransportMode, Transporter, Destination, DeliveryDate, CurrentStatus, InvoiceNo, LrNo, ReceivedBy, ClientRef)
SELECT CONCAT('ORD-', YEAR(OrderedAt), '-', NEXT VALUE FOR dbo.OrderNoSeq OVER (ORDER BY OrderedAt)), OutletId, UserId, OrderedAt, 0, 0, 0, 0, 0, Terms,
       N'Lorry', N'Uathayam', N'Bengaluru', CAST(OrderedAt AS DATE), Status,
       NULL, NULL, NULL, CONCAT('seed-', Seed)
FROM @o;

-- 3 products per order, first colour, varied sizes & quantities
INSERT dbo.OrderLines (OrderId, ProductId, ColorId, SizeCode, Sleeve, Qty, UnitPrice, UnitMrp)
SELECT o.OrderId, p.ProductId, c.ColorId, sz.SizeCode, 'FULL', 6 + (o.OrderId * 7 + p.ProductId * 5) % 25, p.FactoryRate, p.Mrp
FROM dbo.Orders o
CROSS APPLY (SELECT TOP (3) ProductId, FactoryRate, Mrp FROM dbo.Products ORDER BY (ProductId + o.OrderId) % 6) p
CROSS APPLY (SELECT TOP (1) ColorId FROM dbo.ProductColors WHERE ProductId = p.ProductId ORDER BY ColorId) c
CROSS APPLY (SELECT SizeCode FROM dbo.Sizes WHERE SortOrder = 1 + (o.OrderId + p.ProductId) % 6) sz;

UPDATE o SET SubTotal = t.Sub, MrpValue = t.Mrp, TotalPieces = t.Pcs,
             TaxAmount = ROUND(t.Sub * 0.05, 0), TotalAmount = t.Sub + ROUND(t.Sub * 0.05, 0),
             InvoiceNo  = CASE WHEN st.SortOrder >= 4 THEN CONCAT('INV/26-27/', o.OrderId + 1000) END,
             LrNo       = CASE WHEN st.SortOrder >= 5 THEN CONCAT('LR-', 55000 + o.OrderId) END,
             ReceivedBy = CASE WHEN st.SortOrder >= 3 THEN N'Outlet owner' END
FROM dbo.Orders o
JOIN dbo.OrderStatuses st ON st.StatusCode = o.CurrentStatus
JOIN (SELECT OrderId, SUM(LineAmount) Sub, SUM(Qty * UnitMrp) Mrp, SUM(Qty) Pcs FROM dbo.OrderLines GROUP BY OrderId) t ON t.OrderId = o.OrderId;

-- status log: one stamp per reached status, a few hours apart
INSERT dbo.OrderStatusLog (OrderId, StatusCode, ChangedAt, ChangedBy)
SELECT o.OrderId, s.StatusCode, DATEADD(HOUR, (s.SortOrder - 1) * 7, o.OrderedAt), CASE WHEN s.SortOrder = 1 THEN o.UserId ELSE 2 END
FROM dbo.Orders o
JOIN dbo.OrderStatuses cur ON cur.StatusCode = o.CurrentStatus
JOIN dbo.OrderStatuses s ON s.SortOrder <= cur.SortOrder;

/* ── Payments ── */
INSERT dbo.Payments (ReceiptNo, OutletId, UserId, Amount, Method, CollectedAt)
SELECT CONCAT('RCP-', NEXT VALUE FOR dbo.ReceiptNoSeq), o.OutletId, o.UserId, ROUND(o.TotalAmount * 0.6, 0),
       CASE o.OrderId % 3 WHEN 0 THEN 'CASH' WHEN 1 THEN 'UPI' ELSE 'CHEQUE' END, DATEADD(DAY, 3, o.OrderedAt)
FROM dbo.Orders o WHERE o.CurrentStatus = 'COMPLETED' AND o.PaymentTerms = 'CREDIT';

/* ── Beat visits (monthly NV / MV / V2 / V3 indicator + productive calls) ── */
DECLARE @bv TABLE (BeatId INT, UserId INT, VisitDate DATE, V INT, O INT);
INSERT @bv VALUES
 (1,3,DATEADD(DAY,0,@ms),16,12),(1,3,DATEADD(DAY,4,@ms),9,8),(1,3,DATEADD(DAY,7,@ms),16,13),
 (2,3,DATEADD(DAY,1,@ms),12,9),(2,3,DATEADD(DAY,8,@ms),12,10),
 (3,3,DATEADD(DAY,2,@ms),13,4),
 (4,3,DATEADD(DAY,20,@lastMs),14,7),(5,3,DATEADD(DAY,25,@lastMs),11,9),(6,3,DATEADD(DAY,28,@lastMs),17,5),
 (2,4,DATEADD(DAY,2,@ms),12,10),(3,5,DATEADD(DAY,3,@ms),14,5),(4,6,DATEADD(DAY,1,@ms),15,9),(6,7,DATEADD(DAY,5,@ms),19,11);
-- clamp future dates to today (early in the month) and merge collisions
INSERT dbo.BeatVisits (BeatId, UserId, VisitDate, DealersVisited, DealersOrdered)
SELECT BeatId, UserId, d, SUM(V), SUM(O)
FROM (SELECT BeatId, UserId, CASE WHEN VisitDate > @today THEN @today ELSE VisitDate END AS d, V, O FROM @bv) x
GROUP BY BeatId, UserId, d;

/* ── Journey plans: Ravi (draft, current month), Suresh (approved) ── */
INSERT dbo.JourneyPlans (UserId, PlanYear, PlanMonth, Status, SubmittedAt, ActionedBy, ActionedAt)
VALUES (3, YEAR(@today), MONTH(@today), 'DRAFT', NULL, NULL, NULL),
       (4, YEAR(@today), MONTH(@today), 'APPROVED', DATEADD(DAY,-10,SYSUTCDATETIME()), 2, DATEADD(DAY,-9,SYSUTCDATETIME()));
DECLARE @planRavi INT = (SELECT PlanId FROM dbo.JourneyPlans WHERE UserId = 3);
DECLARE @planSuresh INT = (SELECT PlanId FROM dbo.JourneyPlans WHERE UserId = 4);
;WITH days AS (SELECT TOP (DAY(EOMONTH(@today))) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS d FROM sys.all_objects)
INSERT dbo.JourneyPlanDays (PlanId, PlanDay, BeatId)
SELECT p.PlanId, days.d, CASE p.UserId WHEN 3 THEN ((days.d - 1) % 4) + 1 ELSE CASE WHEN days.d % 2 = 0 THEN 2 ELSE 5 END END
FROM days CROSS JOIN (VALUES (@planRavi, 3), (@planSuresh, 4)) p(PlanId, UserId)
WHERE DATEDIFF(DAY, '19000107', DATEADD(DAY, days.d - 1, @ms)) % 7 <> 0   -- skip Sundays (independent of DATEFIRST)
  AND (p.UserId = 4 OR days.d <= 12);

/* ── Attendance history (this month, weekdays before today) ── */
;WITH days AS (SELECT TOP (31) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS k FROM sys.all_objects)
INSERT dbo.AttendanceDays (UserId, WorkDate, TravelMode, OdoStart, OdoEnd, IsLate, DayStartedAt, DayEndedAt, StartLat, StartLng)
SELECT u.UserId, DATEADD(DAY, days.k, @ms), 'OWN_VEHICLE', 24000 + days.k * 80, 24000 + days.k * 80 + 60 + u.UserId,
       CASE WHEN (days.k + u.UserId) % 7 = 3 THEN 1 ELSE 0 END,
       DATEADD(MINUTE, CASE WHEN (days.k + u.UserId) % 7 = 3 THEN 288 ELSE 252 END, CAST(DATEADD(DAY, days.k, @ms) AS DATETIME2(0))),
       DATEADD(MINUTE, 780, CAST(DATEADD(DAY, days.k, @ms) AS DATETIME2(0))), 12.935, 77.626
FROM dbo.Users u CROSS JOIN days
WHERE u.RoleCode = 'EXEC' AND DATEADD(DAY, days.k, @ms) < @today
  AND DATEDIFF(DAY, '19000107', DATEADD(DAY, days.k, @ms)) % 7 <> 0
  AND NOT (u.UserId = 3 AND days.k = 11);                              -- Ravi on leave that day
INSERT dbo.AttendanceSessions (UserId, CheckInAt, CheckOutAt)
SELECT UserId, DayStartedAt, DayEndedAt FROM dbo.AttendanceDays;

/* ── Requests waiting for the manager ── */
INSERT dbo.LeaveRequests (UserId, RequestKind, LeaveType, FromDate, ToDate, Reason, Status, ActionedBy, ActionedAt) VALUES
 (4,'LEAVE',N'Casual Leave',DATEADD(DAY,3,@today),DATEADD(DAY,4,@today),N'Family function','PENDING',NULL,NULL),
 (3,'LEAVE',N'Casual Leave',DATEADD(DAY,11,@ms),DATEADD(DAY,11,@ms),N'Personal work','APPROVED',2,SYSUTCDATETIME()),
 (3,'PERMISSION',N'Permission',DATEADD(DAY,7,@ms),DATEADD(DAY,7,@ms),N'Bank visit · 2 hrs','APPROVED',2,SYSUTCDATETIME());
INSERT dbo.Regularizations (UserId, WorkDate, Reason) VALUES (3, DATEADD(DAY,3,@ms), N'Late check-in — vehicle breakdown');
INSERT dbo.BeatChangeRequests (UserId, FromBeatId, ToBeatId, ForDate, Remarks) VALUES (5, 3, 4, @today, N'Owner shifted area');
INSERT dbo.Expenses (UserId, ExpenseDate, ExpenseType, Amount, LimitAmount, Status, ActionedBy, ActionedAt, ManagerRemark) VALUES
 (3,DATEADD(DAY,-1,@today),'FUEL',640,800,'APPROVED',2,SYSUTCDATETIME(),NULL),
 (3,DATEADD(DAY,-2,@today),'FOOD',220,250,'APPROVED',2,SYSUTCDATETIME(),NULL),
 (3,DATEADD(DAY,-3,@today),'STAY',1450,1200,'REJECTED',2,SYSUTCDATETIME(),N'Exceeds limit'),
 (3,DATEADD(DAY,-4,@today),'FUEL',700,800,'PENDING',NULL,NULL,NULL),
 (6,DATEADD(DAY,-1,@today),'STAY',1450,1200,'PENDING',NULL,NULL,NULL);

/* ── GPS trail for today ── */
INSERT dbo.GpsPoints (UserId, CapturedAt, Latitude, Longitude, Label, IsDeviation)
SELECT u.UserId, DATEADD(MINUTE, 222 + g.k * 40, CAST(@today AS DATETIME2(0))),
       12.900 + u.UserId * 0.01 + g.k * 0.002, 77.580 + u.UserId * 0.01 + g.k * 0.003,
       CASE g.k WHEN 0 THEN N'Day started' ELSE CONCAT(N'Visit ', g.k) END,
       CASE WHEN u.UserId = 3 AND g.k = 2 THEN 1 ELSE 0 END
FROM dbo.Users u CROSS JOIN (VALUES (0),(1),(2),(3)) g(k)
WHERE u.RoleCode = 'EXEC' AND u.UserId <> 5;

/* ── Notifications ── */
INSERT dbo.Notifications (UserId, Icon, Title, Body, Tone, Link) VALUES
 (3,N'🎁',N'Scheme active',N'CARLOS — Buy 10 Get 1 Free ends in 3 days','amber',NULL),
 (3,N'📦',N'Stock refilled',N'NEXUS DOBBY back in stock at warehouse','green',NULL),
 (3,N'⚠️',N'High outstanding',N'Royal Textiles crossed ₹90k outstanding','red','/outlets'),
 (3,N'🎯',N'Target milestone',N'Keep going — check your monthly target progress','blue','/targets'),
 (3,N'🔴',N'Out of stock',N'AFRO is out of stock in all sizes','red',NULL);

/* ── Sample pads issued on delivery challans ── */
SET IDENTITY_INSERT dbo.DeliveryChallans ON;
INSERT dbo.DeliveryChallans (DcId, DcNo, DcDate, UserId) VALUES
 (1,'DC/26-27/0871',DATEADD(DAY,-30,@today),3),(2,'DC/26-27/0902',DATEADD(DAY,-26,@today),3),(3,'DC/26-27/0915',DATEADD(DAY,-24,@today),3),
 (4,'DC/26-27/0866',DATEADD(DAY,-32,@today),4),(5,'DC/26-27/0910',DATEADD(DAY,-25,@today),4),
 (6,'DC/26-27/0899',DATEADD(DAY,-27,@today),5),(7,'DC/26-27/0921',DATEADD(DAY,-23,@today),6),(8,'DC/26-27/0884',DATEADD(DAY,-28,@today),7);
SET IDENTITY_INSERT dbo.DeliveryChallans OFF;
INSERT dbo.SamplePads (DcId, ItemCode, PadName, Subgroup, Qty, AckAt, AckVia, Remarks) VALUES
 (1,'SP01',N'ARISER FORMAL SHIRTING PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (1,'SP02',N'ARISER LINEN SHADE PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (2,'SP03',N'NEXUS DOBBY SWATCH PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (2,'SP04',N'SILK SATIN SHADE CARD',N'Subgroup 9',2,NULL,NULL,N'2 pads – one for showroom display'),
 (2,'SP05',N'KANSAS TROUSER PAD',N'Subgroup 11',1,NULL,NULL,NULL),
 (3,'SP06',N'CARLOS COLOUR PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (4,'SP07',N'ARISER FORMAL SHIRTING PAD',N'Subgroup 7',1,DATEADD(DAY,-31,SYSUTCDATETIME()),'QR_SCAN',N'Handed over at Indiranagar depot'),
 (4,'SP08',N'AFRO CASUAL SHADE PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (5,'SP09',N'ALTO CHECKS PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (6,'SP10',N'KANSAS TROUSER PAD',N'Subgroup 11',1,DATEADD(DAY,-27,SYSUTCDATETIME()),'QR_SCAN',N'Replacement for damaged pad'),
 (6,'SP11',N'SILK SATIN SHADE CARD',N'Subgroup 9',1,NULL,NULL,NULL),
 (7,'SP12',N'NEXUS DOBBY SWATCH PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (7,'SP13',N'AFRO CASUAL SHADE PAD',N'Subgroup 7',1,NULL,NULL,NULL),
 (8,'SP14',N'CARLOS COLOUR PAD',N'Subgroup 7',1,DATEADD(DAY,-27,SYSUTCDATETIME()),'QR_SCAN',NULL);

COMMIT;
PRINT 'Demo data loaded.';
GO
