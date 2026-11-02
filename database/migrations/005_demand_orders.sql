/* ═══════════════════════════════════════════════════════════════════════
   Demand orders: customer requirements for items that are out of stock,
   stopped or not stocked at all.
   • Kept apart from dbo.Orders so they never touch outlet balances, targets,
     sales reports or stock — a demand is a request, not a sale.
   • Lines track requested vs fulfilled quantity.
   • Fulfilment creates a regular dbo.Orders row (linked through
     Orders.DemandOrderId) that then follows the existing approval → invoice →
     dispatch lifecycle. Stock is never reserved or reduced by a demand.
   ═══════════════════════════════════════════════════════════════════════ */

CREATE TABLE dbo.DemandOrderStatuses (
  StatusCode   VARCHAR(20)  NOT NULL CONSTRAINT PK_DemandOrderStatuses PRIMARY KEY,
  Label        NVARCHAR(40) NOT NULL,
  SortOrder    TINYINT      NOT NULL CONSTRAINT UQ_DemandOrderStatuses_Sort UNIQUE,
  IsFinal      BIT          NOT NULL CONSTRAINT DF_DOS_Final DEFAULT 0
);
GO
INSERT dbo.DemandOrderStatuses (StatusCode, Label, SortOrder, IsFinal) VALUES
  ('PENDING', N'Pending', 1, 0), ('APPROVED', N'Approved', 2, 0), ('PROCESSING', N'Processing', 3, 0),
  ('PARTIALLY_FULFILLED', N'Partially Fulfilled', 4, 0), ('FULFILLED', N'Fulfilled', 5, 1), ('REJECTED', N'Rejected', 6, 1);
GO

CREATE SEQUENCE dbo.DemandOrderNoSeq AS INT START WITH 1001 INCREMENT BY 1;
GO

CREATE TABLE dbo.DemandOrders (
  DemandOrderId  INT IDENTITY(1,1) CONSTRAINT PK_DemandOrders PRIMARY KEY,
  DemandNo       VARCHAR(20)   NOT NULL CONSTRAINT UQ_DemandOrders_No UNIQUE,
  OutletId       INT           NOT NULL CONSTRAINT FK_DO_Outlets REFERENCES dbo.Outlets(OutletId),
  UserId         INT           NOT NULL CONSTRAINT FK_DO_Users REFERENCES dbo.Users(UserId),
  OrderedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_DO_At DEFAULT SYSUTCDATETIME(),
  TotalPieces    INT           NOT NULL CONSTRAINT CK_DO_Pieces CHECK (TotalPieces > 0),
  SubTotal       DECIMAL(14,2) NOT NULL CONSTRAINT CK_DO_Sub CHECK (SubTotal >= 0),   -- estimated value at dealer price
  MrpValue       DECIMAL(14,2) NOT NULL,
  Remarks        NVARCHAR(500) NULL,
  ExpectedBy     DATE          NULL,          -- date the customer needs the goods by
  CurrentStatus  VARCHAR(20)   NOT NULL CONSTRAINT FK_DO_Status REFERENCES dbo.DemandOrderStatuses(StatusCode),
  ReviewedBy     INT           NULL CONSTRAINT FK_DO_ReviewedBy REFERENCES dbo.Users(UserId),
  ReviewedAt     DATETIME2(0)  NULL,
  ReviewNote     NVARCHAR(200) NULL,
  Latitude       DECIMAL(9,6)  NULL,
  Longitude      DECIMAL(9,6)  NULL,
  ClientRef      VARCHAR(40)   NULL           -- idempotency key from the device
);
CREATE UNIQUE INDEX UX_DO_ClientRef ON dbo.DemandOrders(UserId, ClientRef) WHERE ClientRef IS NOT NULL;
CREATE INDEX IX_DO_UserDate ON dbo.DemandOrders(UserId, OrderedAt DESC) INCLUDE (CurrentStatus, TotalPieces);
CREATE INDEX IX_DO_Outlet ON dbo.DemandOrders(OutletId, OrderedAt DESC);
CREATE INDEX IX_DO_Status ON dbo.DemandOrders(CurrentStatus, OrderedAt DESC);
GO

CREATE TABLE dbo.DemandOrderLines (
  DemandLineId   INT IDENTITY(1,1) CONSTRAINT PK_DemandOrderLines PRIMARY KEY,
  DemandOrderId  INT           NOT NULL CONSTRAINT FK_DOL_DemandOrders REFERENCES dbo.DemandOrders(DemandOrderId) ON DELETE CASCADE,
  ProductId      INT           NOT NULL CONSTRAINT FK_DOL_Products REFERENCES dbo.Products(ProductId),
  ColorId        INT           NOT NULL CONSTRAINT FK_DOL_Colors REFERENCES dbo.ProductColors(ColorId),
  SizeCode       VARCHAR(5)    NOT NULL CONSTRAINT FK_DOL_Sizes REFERENCES dbo.Sizes(SizeCode),
  Sleeve         VARCHAR(4)    NOT NULL CONSTRAINT CK_DOL_Sleeve CHECK (Sleeve IN ('FULL','HALF')),
  Qty            INT           NOT NULL CONSTRAINT CK_DOL_Qty CHECK (Qty > 0),
  FulfilledQty   INT           NOT NULL CONSTRAINT DF_DOL_Fulfilled DEFAULT 0,
  UnitPrice      DECIMAL(10,2) NOT NULL,
  UnitMrp        DECIMAL(10,2) NOT NULL,
  LineAmount     AS (Qty * UnitPrice) PERSISTED,
  StockStatusAtOrder VARCHAR(10) NOT NULL,     -- snapshot of the cell when the demand was captured
  StockQtyAtOrder    INT         NOT NULL CONSTRAINT DF_DOL_StockQty DEFAULT 0,
  CONSTRAINT CK_DOL_Fulfilled CHECK (FulfilledQty BETWEEN 0 AND Qty),
  CONSTRAINT UQ_DOL UNIQUE (DemandOrderId, ColorId, SizeCode, Sleeve)
);
CREATE INDEX IX_DOL_Product ON dbo.DemandOrderLines(ProductId) INCLUDE (Qty, FulfilledQty);
GO

CREATE TABLE dbo.DemandOrderStatusLog (
  LogId          INT IDENTITY(1,1) CONSTRAINT PK_DemandOrderStatusLog PRIMARY KEY,
  DemandOrderId  INT           NOT NULL CONSTRAINT FK_DOSL_DemandOrders REFERENCES dbo.DemandOrders(DemandOrderId) ON DELETE CASCADE,
  StatusCode     VARCHAR(20)   NOT NULL CONSTRAINT FK_DOSL_Status REFERENCES dbo.DemandOrderStatuses(StatusCode),
  ChangedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_DOSL_At DEFAULT SYSUTCDATETIME(),
  ChangedBy      INT           NULL CONSTRAINT FK_DOSL_Users REFERENCES dbo.Users(UserId),
  Note           NVARCHAR(200) NULL
);
CREATE INDEX IX_DOSL_Order ON dbo.DemandOrderStatusLog(DemandOrderId, ChangedAt);
GO

-- Regular orders raised to fulfil a demand.
ALTER TABLE dbo.Orders ADD DemandOrderId INT NULL CONSTRAINT FK_Orders_DemandOrders REFERENCES dbo.DemandOrders(DemandOrderId);
GO
CREATE INDEX IX_Orders_Demand ON dbo.Orders(DemandOrderId) WHERE DemandOrderId IS NOT NULL;
GO

-- Which demand line each fulfilment order covered, and how many pieces.
CREATE TABLE dbo.DemandFulfilments (
  DemandLineId   INT          NOT NULL CONSTRAINT FK_DF_Lines REFERENCES dbo.DemandOrderLines(DemandLineId),
  OrderId        INT          NOT NULL CONSTRAINT FK_DF_Orders REFERENCES dbo.Orders(OrderId),
  Qty            INT          NOT NULL CONSTRAINT CK_DF_Qty CHECK (Qty > 0),
  CreatedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_DF_At DEFAULT SYSUTCDATETIME(),
  CreatedBy      INT          NOT NULL CONSTRAINT FK_DF_Users REFERENCES dbo.Users(UserId),
  CONSTRAINT PK_DemandFulfilments PRIMARY KEY (DemandLineId, OrderId)
);
GO
