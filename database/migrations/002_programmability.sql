/* ═══════════════════════════════════════════════════════════════════════
   Views and stored procedures
   ═══════════════════════════════════════════════════════════════════════ */

/* Outlet balance: opening outstanding + credit orders − collections.
   LastMonthSales = previous calendar month; feeds the "LM" chip and performance flag. */
CREATE OR ALTER VIEW dbo.vw_OutletBalance
AS
SELECT o.OutletId,
       CAST(o.OpeningOutstanding + ISNULL(ord.CreditTotal, 0) - ISNULL(pay.Paid, 0) AS DECIMAL(14,2)) AS Outstanding,
       CAST(ISNULL(ord.LastMonthSales, 0) AS DECIMAL(14,2)) AS LastMonthSales,
       ord.LastOrderAt
FROM dbo.Outlets o
OUTER APPLY (
  SELECT SUM(CASE WHEN x.PaymentTerms = 'CREDIT' THEN x.TotalAmount ELSE 0 END) AS CreditTotal,
         SUM(CASE WHEN x.OrderedAt >= DATEADD(MONTH, DATEDIFF(MONTH, 0, SYSUTCDATETIME()) - 1, 0)
                   AND x.OrderedAt <  DATEADD(MONTH, DATEDIFF(MONTH, 0, SYSUTCDATETIME()), 0)
                  THEN x.TotalAmount ELSE 0 END) AS LastMonthSales,
         MAX(x.OrderedAt) AS LastOrderAt
  FROM dbo.Orders x WHERE x.OutletId = o.OutletId
) ord
OUTER APPLY (SELECT SUM(p.Amount) AS Paid FROM dbo.Payments p WHERE p.OutletId = o.OutletId) pay;
GO

/* Beat summary: outlet count + A/B/C mix of approved outlets */
CREATE OR ALTER VIEW dbo.vw_BeatSummary
AS
SELECT b.BeatId, b.BeatCode, b.BeatName, b.Area, b.ColorTag,
       COUNT(o.OutletId) AS OutletCount,
       SUM(CASE WHEN o.OutletClass = 'A' THEN 1 ELSE 0 END) AS ClassA,
       SUM(CASE WHEN o.OutletClass = 'B' THEN 1 ELSE 0 END) AS ClassB,
       SUM(CASE WHEN o.OutletClass = 'C' THEN 1 ELSE 0 END) AS ClassC
FROM dbo.Beats b
LEFT JOIN dbo.Outlets o ON o.BeatId = b.BeatId AND o.ApprovalStatus = 'APPROVED'
WHERE b.IsActive = 1
GROUP BY b.BeatId, b.BeatCode, b.BeatName, b.Area, b.ColorTag;
GO

/* Records an outlet visit (order or no-order remark) and keeps the beat's daily
   visit counters in step: first visit of an outlet today adds 1 dealer visited;
   the first order from that outlet today adds 1 dealer ordered. */
CREATE OR ALTER PROCEDURE dbo.usp_RecordOutletVisit
  @UserId INT, @OutletId INT, @VisitDate DATE, @Ordered BIT,
  @NoOrderReason NVARCHAR(60) = NULL, @Notes NVARCHAR(500) = NULL,
  @Latitude DECIMAL(9,6) = NULL, @Longitude DECIMAL(9,6) = NULL, @DistanceM INT = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @BeatId INT = (SELECT BeatId FROM dbo.Outlets WHERE OutletId = @OutletId);
  IF @BeatId IS NULL THROW 50001, 'Outlet not found', 1;

  BEGIN TRAN;
    DECLARE @wasOrdered BIT, @isNew BIT = 0;
    SELECT @wasOrdered = Ordered FROM dbo.OutletVisits WITH (UPDLOCK, HOLDLOCK)
     WHERE OutletId = @OutletId AND UserId = @UserId AND VisitDate = @VisitDate;

    IF @wasOrdered IS NULL
    BEGIN
      SET @isNew = 1;
      INSERT dbo.OutletVisits (OutletId, UserId, VisitDate, Ordered, NoOrderReason, Notes, Latitude, Longitude, DistanceM, CheckOutAt)
      VALUES (@OutletId, @UserId, @VisitDate, @Ordered, @NoOrderReason, @Notes, @Latitude, @Longitude, @DistanceM, SYSUTCDATETIME());
    END
    ELSE
      UPDATE dbo.OutletVisits
         SET Ordered = CASE WHEN Ordered = 1 OR @Ordered = 1 THEN 1 ELSE 0 END,
             NoOrderReason = COALESCE(@NoOrderReason, NoOrderReason),
             Notes = COALESCE(@Notes, Notes), CheckOutAt = SYSUTCDATETIME()
       WHERE OutletId = @OutletId AND UserId = @UserId AND VisitDate = @VisitDate;

    DECLARE @addVisited INT = CASE WHEN @isNew = 1 THEN 1 ELSE 0 END;
    DECLARE @addOrdered INT = CASE WHEN @Ordered = 1 AND ISNULL(@wasOrdered, 0) = 0 THEN 1 ELSE 0 END;

    IF @addVisited + @addOrdered > 0
      MERGE dbo.BeatVisits WITH (HOLDLOCK) AS t
      USING (SELECT @BeatId AS BeatId, @UserId AS UserId, @VisitDate AS VisitDate) s
         ON t.BeatId = s.BeatId AND t.UserId = s.UserId AND t.VisitDate = s.VisitDate
      WHEN MATCHED THEN UPDATE SET DealersVisited = t.DealersVisited + @addVisited,
                                   DealersOrdered = t.DealersOrdered + @addOrdered
      WHEN NOT MATCHED THEN INSERT (BeatId, UserId, VisitDate, DealersVisited, DealersOrdered)
                            VALUES (s.BeatId, s.UserId, s.VisitDate, @addVisited, @addOrdered);
  COMMIT;
END
GO

/* Manual "Log beat visit": adds to today's counters (or creates the row). */
CREATE OR ALTER PROCEDURE dbo.usp_LogBeatVisit
  @UserId INT, @BeatId INT, @VisitDate DATE, @Visited INT, @Ordered INT
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @Visited < 1 OR @Ordered < 0 OR @Ordered > @Visited THROW 50002, 'Ordered dealers must be between 0 and dealers visited', 1;
  MERGE dbo.BeatVisits WITH (HOLDLOCK) AS t
  USING (SELECT @BeatId AS BeatId, @UserId AS UserId, @VisitDate AS VisitDate) s
     ON t.BeatId = s.BeatId AND t.UserId = s.UserId AND t.VisitDate = s.VisitDate
  WHEN MATCHED THEN UPDATE SET DealersVisited = t.DealersVisited + @Visited, DealersOrdered = t.DealersOrdered + @Ordered
  WHEN NOT MATCHED THEN INSERT (BeatId, UserId, VisitDate, DealersVisited, DealersOrdered)
                        VALUES (@BeatId, @UserId, @VisitDate, @Visited, @Ordered);
END
GO

/* Moves an order to its next lifecycle status, stamping invoice / LR numbers. */
CREATE OR ALTER PROCEDURE dbo.usp_AdvanceOrderStatus
  @OrderId INT, @ChangedBy INT, @ReceivedBy NVARCHAR(80) = NULL, @Note NVARCHAR(200) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRAN;
    DECLARE @cur VARCHAR(12), @sort TINYINT, @next VARCHAR(12);
    SELECT @cur = o.CurrentStatus, @sort = s.SortOrder
      FROM dbo.Orders o WITH (UPDLOCK) JOIN dbo.OrderStatuses s ON s.StatusCode = o.CurrentStatus
     WHERE o.OrderId = @OrderId;
    IF @cur IS NULL THROW 50003, 'Order not found', 1;
    SELECT @next = StatusCode FROM dbo.OrderStatuses WHERE SortOrder = @sort + 1;
    IF @next IS NULL THROW 50004, 'Order is already completed', 1;
    IF @next = 'APPROVED' AND EXISTS (SELECT 1 FROM dbo.Orders WHERE OrderId = @OrderId AND CreditHold = 1)
      UPDATE dbo.Orders SET CreditHold = 0 WHERE OrderId = @OrderId;     -- manager approval clears the hold

    UPDATE dbo.Orders
       SET CurrentStatus = @next,
           InvoiceNo  = CASE WHEN @next = 'INVOICED'   AND InvoiceNo IS NULL THEN CONCAT('INV/', FORMAT(SYSUTCDATETIME(),'yy'), '-', FORMAT(DATEADD(YEAR,1,SYSUTCDATETIME()),'yy'), '/', OrderId + 1000) ELSE InvoiceNo END,
           LrNo       = CASE WHEN @next = 'DISPATCHED' AND LrNo IS NULL THEN CONCAT('LR-', 55000 + OrderId) ELSE LrNo END,
           ReceivedBy = CASE WHEN @next = 'DELIVERED' THEN COALESCE(@ReceivedBy, ReceivedBy, N'Outlet owner') ELSE ReceivedBy END
     WHERE OrderId = @OrderId;
    INSERT dbo.OrderStatusLog (OrderId, StatusCode, ChangedBy, Note) VALUES (@OrderId, @next, @ChangedBy, @Note);
  COMMIT;
  SELECT @next AS NewStatus;
END
GO

/* Replaces all days of a journey plan from JSON [{"day":1,"beatId":3},…] and resets it to DRAFT. */
CREATE OR ALTER PROCEDURE dbo.usp_SaveJourneyPlanDays
  @PlanId INT, @DaysJson NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF EXISTS (SELECT 1 FROM dbo.JourneyPlans WHERE PlanId = @PlanId AND Status = 'PENDING')
    THROW 50005, 'Plan is locked while pending approval', 1;
  BEGIN TRAN;
    DELETE dbo.JourneyPlanDays WHERE PlanId = @PlanId;
    INSERT dbo.JourneyPlanDays (PlanId, PlanDay, BeatId)
    SELECT @PlanId, j.[day], j.beatId
      FROM OPENJSON(@DaysJson) WITH ([day] TINYINT '$.day', beatId INT '$.beatId') j;
    UPDATE dbo.JourneyPlans SET Status = 'DRAFT', ManagerNote = CASE WHEN Status = 'SENTBACK' THEN ManagerNote END
     WHERE PlanId = @PlanId;
  COMMIT;
END
GO
