/* ═══════════════════════════════════════════════════════════════════════
   Marketing Management Application — core schema (MSSQL 2017+)
   Run through `npm run db:migrate` (backend) or sqlcmd. Batches split on GO.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Security & organisation ─────────────────────────────────────────── */
CREATE TABLE dbo.Roles (
  RoleCode     VARCHAR(20)   NOT NULL CONSTRAINT PK_Roles PRIMARY KEY,   -- EXEC | MANAGER | ADMIN
  RoleName     NVARCHAR(60)  NOT NULL
);
GO
CREATE TABLE dbo.Users (
  UserId       INT IDENTITY(1,1) CONSTRAINT PK_Users PRIMARY KEY,
  EmpCode      VARCHAR(20)   NOT NULL CONSTRAINT UQ_Users_EmpCode UNIQUE,
  FullName     NVARCHAR(100) NOT NULL,
  Mobile       VARCHAR(15)   NOT NULL CONSTRAINT UQ_Users_Mobile UNIQUE,
  Email        NVARCHAR(150) NULL,
  RoleCode     VARCHAR(20)   NOT NULL CONSTRAINT FK_Users_Roles REFERENCES dbo.Roles(RoleCode),
  Designation  NVARCHAR(80)  NULL,
  Region       NVARCHAR(80)  NULL,
  Territory    NVARCHAR(80)  NULL,
  ManagerId    INT           NULL CONSTRAINT FK_Users_Manager REFERENCES dbo.Users(UserId),
  IsActive     BIT           NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
  CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Users_Manager ON dbo.Users(ManagerId) WHERE ManagerId IS NOT NULL;
GO
CREATE TABLE dbo.OtpCodes (
  OtpId        INT IDENTITY(1,1) CONSTRAINT PK_OtpCodes PRIMARY KEY,
  UserId       INT          NOT NULL CONSTRAINT FK_Otp_Users REFERENCES dbo.Users(UserId),
  CodeHash     VARCHAR(100) NOT NULL,
  ExpiresAt    DATETIME2(0) NOT NULL,
  Attempts     TINYINT      NOT NULL CONSTRAINT DF_Otp_Attempts DEFAULT 0,
  ConsumedAt   DATETIME2(0) NULL,
  CreatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_Otp_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Otp_User ON dbo.OtpCodes(UserId, CreatedAt DESC);
GO
CREATE TABLE dbo.RefreshTokens (
  TokenId      INT IDENTITY(1,1) CONSTRAINT PK_RefreshTokens PRIMARY KEY,
  UserId       INT          NOT NULL CONSTRAINT FK_Refresh_Users REFERENCES dbo.Users(UserId),
  TokenHash    VARCHAR(100) NOT NULL CONSTRAINT UQ_Refresh_Hash UNIQUE,
  ExpiresAt    DATETIME2(0) NOT NULL,
  RevokedAt    DATETIME2(0) NULL,
  CreatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_Refresh_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO

/* ── Beats & outlets ─────────────────────────────────────────────────── */
CREATE TABLE dbo.Beats (
  BeatId       INT IDENTITY(1,1) CONSTRAINT PK_Beats PRIMARY KEY,
  BeatCode     VARCHAR(20)   NOT NULL CONSTRAINT UQ_Beats_Code UNIQUE,
  BeatName     NVARCHAR(100) NOT NULL,
  Area         NVARCHAR(80)  NOT NULL,
  ColorTag     VARCHAR(10)   NOT NULL CONSTRAINT DF_Beats_Color DEFAULT 'green' CONSTRAINT CK_Beats_Color CHECK (ColorTag IN ('green','teal','amber')),
  IsActive     BIT           NOT NULL CONSTRAINT DF_Beats_IsActive DEFAULT 1
);
GO
CREATE TABLE dbo.BeatAssignments (
  BeatId       INT NOT NULL CONSTRAINT FK_BA_Beats REFERENCES dbo.Beats(BeatId),
  UserId       INT NOT NULL CONSTRAINT FK_BA_Users REFERENCES dbo.Users(UserId),
  CONSTRAINT PK_BeatAssignments PRIMARY KEY (BeatId, UserId)
);
CREATE INDEX IX_BA_User ON dbo.BeatAssignments(UserId);
GO
CREATE TABLE dbo.Outlets (
  OutletId           INT IDENTITY(1,1) CONSTRAINT PK_Outlets PRIMARY KEY,
  OutletName         NVARCHAR(120) NOT NULL,
  OwnerName          NVARCHAR(100) NOT NULL,
  Mobile             VARCHAR(15)   NOT NULL,
  OutletType         NVARCHAR(30)  NOT NULL CONSTRAINT DF_Outlets_Type DEFAULT N'Retailer',
  BeatId             INT           NOT NULL CONSTRAINT FK_Outlets_Beats REFERENCES dbo.Beats(BeatId),
  OutletClass        CHAR(1)       NOT NULL CONSTRAINT DF_Outlets_Class DEFAULT 'C' CONSTRAINT CK_Outlets_Class CHECK (OutletClass IN ('A','B','C')),
  Grade              TINYINT       NOT NULL CONSTRAINT DF_Outlets_Grade DEFAULT 3 CONSTRAINT CK_Outlets_Grade CHECK (Grade BETWEEN 1 AND 5),
  CreditLimit        DECIMAL(14,2) NOT NULL CONSTRAINT DF_Outlets_Credit DEFAULT 0,
  OpeningOutstanding DECIMAL(14,2) NOT NULL CONSTRAINT DF_Outlets_Opening DEFAULT 0,
  Gstin              VARCHAR(15)   NULL,
  Pan                VARCHAR(10)   NULL,
  Building           NVARCHAR(150) NULL,
  AddressLine        NVARCHAR(300) NOT NULL,
  City               NVARCHAR(80)  NOT NULL,
  District           NVARCHAR(80)  NULL,
  StateName          NVARCHAR(80)  NOT NULL,
  PostalCode         CHAR(6)       NOT NULL,
  Latitude           DECIMAL(9,6)  NULL,
  Longitude          DECIMAL(9,6)  NULL,
  ApprovalStatus     VARCHAR(12)   NOT NULL CONSTRAINT DF_Outlets_Status DEFAULT 'PENDING'
                     CONSTRAINT CK_Outlets_Status CHECK (ApprovalStatus IN ('PENDING','APPROVED','REJECTED')),
  ApprovalRemark     NVARCHAR(300) NULL,
  CreatedBy          INT           NULL CONSTRAINT FK_Outlets_CreatedBy REFERENCES dbo.Users(UserId),
  ApprovedBy         INT           NULL CONSTRAINT FK_Outlets_ApprovedBy REFERENCES dbo.Users(UserId),
  CreatedAt          DATETIME2(0)  NOT NULL CONSTRAINT DF_Outlets_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Outlets_Gstin CHECK (Gstin IS NULL OR Gstin LIKE '[0-9][0-9][A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z][1-9A-Z]Z[0-9A-Z]'),
  CONSTRAINT CK_Outlets_Pan   CHECK (Pan IS NULL OR Pan LIKE '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]')
);
CREATE INDEX IX_Outlets_Beat ON dbo.Outlets(BeatId, ApprovalStatus);
GO
CREATE TABLE dbo.OutletDocuments (
  DocumentId   INT IDENTITY(1,1) CONSTRAINT PK_OutletDocuments PRIMARY KEY,
  OutletId     INT           NOT NULL CONSTRAINT FK_OD_Outlets REFERENCES dbo.Outlets(OutletId) ON DELETE CASCADE,
  DocType      VARCHAR(10)   NOT NULL CONSTRAINT CK_OD_Type CHECK (DocType IN ('SHOP','GSTIN','PAN')),
  FilePath     NVARCHAR(260) NOT NULL,
  UploadedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_OD_UploadedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_OD_Outlet ON dbo.OutletDocuments(OutletId);
GO

/* ── Attendance, leave, work logs ───────────────────────────────────── */
CREATE TABLE dbo.AttendanceDays (
  AttendanceDayId INT IDENTITY(1,1) CONSTRAINT PK_AttendanceDays PRIMARY KEY,
  UserId        INT           NOT NULL CONSTRAINT FK_AD_Users REFERENCES dbo.Users(UserId),
  WorkDate      DATE          NOT NULL,
  SelfiePath    NVARCHAR(260) NULL,
  TravelMode    VARCHAR(20)   NOT NULL CONSTRAINT CK_AD_Travel CHECK (TravelMode IN ('OWN_VEHICLE','BUS','CAB','WALK')),
  OdoStart      INT           NULL,
  OdoEnd        INT           NULL,
  StartLat      DECIMAL(9,6)  NULL,
  StartLng      DECIMAL(9,6)  NULL,
  IsLate        BIT           NOT NULL CONSTRAINT DF_AD_IsLate DEFAULT 0,
  DayStartedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_AD_Start DEFAULT SYSUTCDATETIME(),
  DayEndedAt    DATETIME2(0)  NULL,
  CONSTRAINT UQ_AD_UserDate UNIQUE (UserId, WorkDate),
  CONSTRAINT CK_AD_Odo CHECK (OdoEnd IS NULL OR OdoStart IS NULL OR OdoEnd >= OdoStart)
);
GO
CREATE TABLE dbo.AttendanceSessions (
  SessionId    INT IDENTITY(1,1) CONSTRAINT PK_AttendanceSessions PRIMARY KEY,
  UserId       INT          NOT NULL CONSTRAINT FK_AS_Users REFERENCES dbo.Users(UserId),
  CheckInAt    DATETIME2(0) NOT NULL,
  CheckOutAt   DATETIME2(0) NULL,
  CONSTRAINT CK_AS_Order CHECK (CheckOutAt IS NULL OR CheckOutAt >= CheckInAt)
);
-- at most one open session per user
CREATE UNIQUE INDEX UX_AS_OpenSession ON dbo.AttendanceSessions(UserId) WHERE CheckOutAt IS NULL;
CREATE INDEX IX_AS_UserIn ON dbo.AttendanceSessions(UserId, CheckInAt DESC);
GO
CREATE TABLE dbo.LeaveRequests (
  LeaveRequestId INT IDENTITY(1,1) CONSTRAINT PK_LeaveRequests PRIMARY KEY,
  UserId        INT           NOT NULL CONSTRAINT FK_LR_Users REFERENCES dbo.Users(UserId),
  RequestKind   VARCHAR(12)   NOT NULL CONSTRAINT CK_LR_Kind CHECK (RequestKind IN ('LEAVE','PERMISSION')),
  LeaveType     NVARCHAR(40)  NOT NULL,
  FromDate      DATE          NOT NULL,
  ToDate        DATE          NOT NULL,
  Hours         DECIMAL(4,1)  NULL,
  Reason        NVARCHAR(400) NOT NULL,
  Status        VARCHAR(10)   NOT NULL CONSTRAINT DF_LR_Status DEFAULT 'PENDING' CONSTRAINT CK_LR_Status CHECK (Status IN ('PENDING','APPROVED','REJECTED')),
  ManagerRemark NVARCHAR(300) NULL,
  ActionedBy    INT           NULL CONSTRAINT FK_LR_ActionedBy REFERENCES dbo.Users(UserId),
  ActionedAt    DATETIME2(0)  NULL,
  CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_LR_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_LR_Dates CHECK (ToDate >= FromDate)
);
CREATE INDEX IX_LR_UserStatus ON dbo.LeaveRequests(UserId, Status);
GO
CREATE TABLE dbo.Regularizations (
  RegularizationId INT IDENTITY(1,1) CONSTRAINT PK_Regularizations PRIMARY KEY,
  UserId        INT           NOT NULL CONSTRAINT FK_RG_Users REFERENCES dbo.Users(UserId),
  WorkDate      DATE          NOT NULL,
  Reason        NVARCHAR(400) NOT NULL,
  Status        VARCHAR(10)   NOT NULL CONSTRAINT DF_RG_Status DEFAULT 'PENDING' CONSTRAINT CK_RG_Status CHECK (Status IN ('PENDING','APPROVED','REJECTED')),
  ManagerRemark NVARCHAR(300) NULL,
  ActionedBy    INT           NULL CONSTRAINT FK_RG_ActionedBy REFERENCES dbo.Users(UserId),
  ActionedAt    DATETIME2(0)  NULL,
  CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_RG_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE dbo.WorkLogs (
  WorkLogId    INT IDENTITY(1,1) CONSTRAINT PK_WorkLogs PRIMARY KEY,
  UserId       INT           NOT NULL CONSTRAINT FK_WL_Users REFERENCES dbo.Users(UserId),
  WorkType     VARCHAR(15)   NOT NULL CONSTRAINT CK_WL_Type CHECK (WorkType IN ('DISTRIBUTOR','OFFICE','MEETING','JOINED')),
  PlaceName    NVARCHAR(150) NULL,
  JoinedUserId INT           NULL CONSTRAINT FK_WL_Joined REFERENCES dbo.Users(UserId),
  Notes        NVARCHAR(1000) NULL,
  CheckInAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_WL_In DEFAULT SYSUTCDATETIME(),
  CheckOutAt   DATETIME2(0)  NULL,
  Latitude     DECIMAL(9,6)  NULL,
  Longitude    DECIMAL(9,6)  NULL
);
CREATE INDEX IX_WL_UserIn ON dbo.WorkLogs(UserId, CheckInAt DESC);
GO

/* ── Journey plans & beat changes ───────────────────────────────────── */
CREATE TABLE dbo.JourneyPlans (
  PlanId       INT IDENTITY(1,1) CONSTRAINT PK_JourneyPlans PRIMARY KEY,
  UserId       INT           NOT NULL CONSTRAINT FK_JP_Users REFERENCES dbo.Users(UserId),
  PlanYear     SMALLINT      NOT NULL,
  PlanMonth    TINYINT       NOT NULL CONSTRAINT CK_JP_Month CHECK (PlanMonth BETWEEN 1 AND 12),
  Status       VARCHAR(10)   NOT NULL CONSTRAINT DF_JP_Status DEFAULT 'DRAFT' CONSTRAINT CK_JP_Status CHECK (Status IN ('DRAFT','PENDING','APPROVED','SENTBACK')),
  ManagerNote  NVARCHAR(500) NULL,
  SubmittedAt  DATETIME2(0)  NULL,
  ActionedBy   INT           NULL CONSTRAINT FK_JP_ActionedBy REFERENCES dbo.Users(UserId),
  ActionedAt   DATETIME2(0)  NULL,
  CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_JP_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_JP_UserMonth UNIQUE (UserId, PlanYear, PlanMonth)
);
GO
CREATE TABLE dbo.JourneyPlanDays (
  PlanId       INT     NOT NULL CONSTRAINT FK_JPD_Plans REFERENCES dbo.JourneyPlans(PlanId) ON DELETE CASCADE,
  PlanDay      TINYINT NOT NULL CONSTRAINT CK_JPD_Day CHECK (PlanDay BETWEEN 1 AND 31),
  BeatId       INT     NOT NULL CONSTRAINT FK_JPD_Beats REFERENCES dbo.Beats(BeatId),
  CONSTRAINT PK_JourneyPlanDays PRIMARY KEY (PlanId, PlanDay)        -- one beat per working day
);
GO
CREATE TABLE dbo.BeatChangeRequests (
  RequestId     INT IDENTITY(1,1) CONSTRAINT PK_BeatChangeRequests PRIMARY KEY,
  UserId        INT           NOT NULL CONSTRAINT FK_BCR_Users REFERENCES dbo.Users(UserId),
  FromBeatId    INT           NOT NULL CONSTRAINT FK_BCR_From REFERENCES dbo.Beats(BeatId),
  ToBeatId      INT           NOT NULL CONSTRAINT FK_BCR_To REFERENCES dbo.Beats(BeatId),
  ForDate       DATE          NOT NULL,
  Remarks       NVARCHAR(400) NOT NULL,
  Status        VARCHAR(10)   NOT NULL CONSTRAINT DF_BCR_Status DEFAULT 'PENDING' CONSTRAINT CK_BCR_Status CHECK (Status IN ('PENDING','APPROVED','REJECTED')),
  ManagerRemark NVARCHAR(300) NULL,
  ActionedBy    INT           NULL CONSTRAINT FK_BCR_ActionedBy REFERENCES dbo.Users(UserId),
  ActionedAt    DATETIME2(0)  NULL,
  CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_BCR_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_BCR_Diff CHECK (FromBeatId <> ToBeatId)
);
CREATE INDEX IX_BCR_UserCreated ON dbo.BeatChangeRequests(UserId, CreatedAt);
GO

/* ── Visits ─────────────────────────────────────────────────────────── */
-- One row per (beat, executive, day): the monthly NV/MV/V2… indicator and productive calls come from here.
CREATE TABLE dbo.BeatVisits (
  BeatVisitId    INT IDENTITY(1,1) CONSTRAINT PK_BeatVisits PRIMARY KEY,
  BeatId         INT  NOT NULL CONSTRAINT FK_BV_Beats REFERENCES dbo.Beats(BeatId),
  UserId         INT  NOT NULL CONSTRAINT FK_BV_Users REFERENCES dbo.Users(UserId),
  VisitDate      DATE NOT NULL,
  DealersVisited INT  NOT NULL CONSTRAINT CK_BV_Visited CHECK (DealersVisited >= 0),
  DealersOrdered INT  NOT NULL CONSTRAINT CK_BV_Ordered CHECK (DealersOrdered >= 0),
  CONSTRAINT UQ_BV UNIQUE (BeatId, UserId, VisitDate),
  CONSTRAINT CK_BV_Ratio CHECK (DealersOrdered <= DealersVisited)
);
CREATE INDEX IX_BV_BeatDate ON dbo.BeatVisits(BeatId, VisitDate DESC) INCLUDE (DealersVisited, DealersOrdered);
GO
CREATE TABLE dbo.OutletVisits (
  OutletVisitId INT IDENTITY(1,1) CONSTRAINT PK_OutletVisits PRIMARY KEY,
  OutletId      INT           NOT NULL CONSTRAINT FK_OV_Outlets REFERENCES dbo.Outlets(OutletId),
  UserId        INT           NOT NULL CONSTRAINT FK_OV_Users REFERENCES dbo.Users(UserId),
  VisitDate     DATE          NOT NULL,
  CheckInAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_OV_In DEFAULT SYSUTCDATETIME(),
  CheckOutAt    DATETIME2(0)  NULL,
  Ordered       BIT           NOT NULL CONSTRAINT DF_OV_Ordered DEFAULT 0,
  NoOrderReason NVARCHAR(60)  NULL,
  Notes         NVARCHAR(500) NULL,
  Latitude      DECIMAL(9,6)  NULL,
  Longitude     DECIMAL(9,6)  NULL,
  DistanceM     INT           NULL,
  CONSTRAINT UQ_OV UNIQUE (OutletId, UserId, VisitDate)
);
CREATE INDEX IX_OV_UserDate ON dbo.OutletVisits(UserId, VisitDate);
GO

/* ── Products & stock ───────────────────────────────────────────────── */
CREATE TABLE dbo.Products (
  ProductId     INT IDENTITY(1,1) CONSTRAINT PK_Products PRIMARY KEY,
  ProductCode   VARCHAR(20)   NOT NULL CONSTRAINT UQ_Products_Code UNIQUE,     -- internal slug (carlos)
  QrCode        VARCHAR(20)   NOT NULL CONSTRAINT UQ_Products_Qr UNIQUE,       -- ARSR-0001
  ProductName   NVARCHAR(80)  NOT NULL,
  Icon          NVARCHAR(8)   NOT NULL,
  Category      VARCHAR(10)   NOT NULL CONSTRAINT CK_Products_Cat CHECK (Category IN ('shirt','fabric','trouser')),
  Brand         NVARCHAR(40)  NOT NULL,
  SubBrand      NVARCHAR(40)  NOT NULL,
  FactoryRate   DECIMAL(10,2) NOT NULL CONSTRAINT CK_Products_FR CHECK (FactoryRate > 0),
  Mrp           DECIMAL(10,2) NOT NULL,
  SchemeText    NVARCHAR(60)  NULL,           -- "Buy 10 Get 1 Free"
  SchemeBuyQty  INT           NULL,
  SchemeFreeQty INT           NULL,
  AltProductId  INT           NULL CONSTRAINT FK_Products_Alt REFERENCES dbo.Products(ProductId),
  Moq           INT           NOT NULL CONSTRAINT DF_Products_Moq DEFAULT 1,
  NonReturnable BIT           NOT NULL CONSTRAINT DF_Products_NonRet DEFAULT 0,
  Tag           NVARCHAR(20)  NULL,           -- Must Selling | Offer | New Launch | Frequently
  HasSleeves    BIT           NOT NULL CONSTRAINT DF_Products_Sleeves DEFAULT 1,
  HalfSleeveFactor DECIMAL(4,3) NOT NULL CONSTRAINT DF_Products_Half DEFAULT 0.92,
  IsActive      BIT           NOT NULL CONSTRAINT DF_Products_Active DEFAULT 1,
  CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Products_Mrp CHECK (Mrp >= FactoryRate)
);
GO
CREATE TABLE dbo.ProductColors (
  ColorId      INT IDENTITY(1,1) CONSTRAINT PK_ProductColors PRIMARY KEY,
  ProductId    INT          NOT NULL CONSTRAINT FK_PC_Products REFERENCES dbo.Products(ProductId),
  ColorCode    VARCHAR(10)  NOT NULL,
  ColorName    NVARCHAR(40) NOT NULL,
  HexValue     CHAR(7)      NOT NULL,
  IsCore       BIT          NOT NULL CONSTRAINT DF_PC_Core DEFAULT 0,
  CONSTRAINT UQ_PC UNIQUE (ProductId, ColorCode)
);
GO
CREATE TABLE dbo.Sizes (
  SizeCode     VARCHAR(5) NOT NULL CONSTRAINT PK_Sizes PRIMARY KEY,
  SortOrder    TINYINT    NOT NULL
);
GO
-- Stock status per colour × size. STOPPED cells cannot be ordered.
CREATE TABLE dbo.StockLevels (
  ColorId      INT          NOT NULL CONSTRAINT FK_SL_Colors REFERENCES dbo.ProductColors(ColorId),
  SizeCode     VARCHAR(5)   NOT NULL CONSTRAINT FK_SL_Sizes REFERENCES dbo.Sizes(SizeCode),
  QtyOnHand    INT          NOT NULL CONSTRAINT DF_SL_Qty DEFAULT 0,
  StockStatus  VARCHAR(10)  NOT NULL CONSTRAINT CK_SL_Status CHECK (StockStatus IN ('STOPPED','IN_STOCK','OOS_15','REFILL_13','REFILL_30')),
  UpdatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_SL_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_StockLevels PRIMARY KEY (ColorId, SizeCode)
);
GO

/* ── Orders ─────────────────────────────────────────────────────────── */
CREATE TABLE dbo.OrderStatuses (
  StatusCode   VARCHAR(12)  NOT NULL CONSTRAINT PK_OrderStatuses PRIMARY KEY,
  Label        NVARCHAR(40) NOT NULL,
  SortOrder    TINYINT      NOT NULL CONSTRAINT UQ_OrderStatuses_Sort UNIQUE
);
GO
CREATE SEQUENCE dbo.OrderNoSeq AS INT START WITH 8830 INCREMENT BY 1;
GO
CREATE TABLE dbo.Orders (
  OrderId        INT IDENTITY(1,1) CONSTRAINT PK_Orders PRIMARY KEY,
  OrderNo        VARCHAR(20)   NOT NULL CONSTRAINT UQ_Orders_No UNIQUE,
  OutletId       INT           NOT NULL CONSTRAINT FK_Orders_Outlets REFERENCES dbo.Outlets(OutletId),
  UserId         INT           NOT NULL CONSTRAINT FK_Orders_Users REFERENCES dbo.Users(UserId),
  OrderedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_Orders_At DEFAULT SYSUTCDATETIME(),
  SubTotal       DECIMAL(14,2) NOT NULL,
  MrpValue       DECIMAL(14,2) NOT NULL,
  SchemeValue    DECIMAL(14,2) NOT NULL CONSTRAINT DF_Orders_Scheme DEFAULT 0,
  TaxAmount      DECIMAL(14,2) NOT NULL,
  TotalAmount    DECIMAL(14,2) NOT NULL,
  TotalPieces    INT           NOT NULL,
  PaymentTerms   VARCHAR(10)   NOT NULL CONSTRAINT CK_Orders_Terms CHECK (PaymentTerms IN ('CREDIT','CASH','ONLINE')),
  Instructions   NVARCHAR(500) NULL,
  SignaturePath  NVARCHAR(260) NULL,
  TransportMode  NVARCHAR(20)  NULL,
  Transporter    NVARCHAR(80)  NULL,
  Destination    NVARCHAR(120) NULL,
  DeliveryDate   DATE          NULL,
  CurrentStatus  VARCHAR(12)   NOT NULL CONSTRAINT FK_Orders_Status REFERENCES dbo.OrderStatuses(StatusCode),
  CreditHold     BIT           NOT NULL CONSTRAINT DF_Orders_Hold DEFAULT 0,   -- order + outstanding > credit limit
  InvoiceNo      VARCHAR(30)   NULL,
  LrNo           VARCHAR(30)   NULL,
  ReceivedBy     NVARCHAR(80)  NULL,
  Latitude       DECIMAL(9,6)  NULL,
  Longitude      DECIMAL(9,6)  NULL,
  ClientRef      VARCHAR(40)   NULL,       -- idempotency key from the device
  CONSTRAINT CK_Orders_Total CHECK (TotalAmount >= 0)
);
CREATE UNIQUE INDEX UX_Orders_ClientRef ON dbo.Orders(UserId, ClientRef) WHERE ClientRef IS NOT NULL;
CREATE INDEX IX_Orders_UserDate ON dbo.Orders(UserId, OrderedAt DESC) INCLUDE (TotalAmount, CurrentStatus);
CREATE INDEX IX_Orders_Outlet ON dbo.Orders(OutletId, OrderedAt DESC);
GO
CREATE TABLE dbo.OrderLines (
  OrderLineId  INT IDENTITY(1,1) CONSTRAINT PK_OrderLines PRIMARY KEY,
  OrderId      INT           NOT NULL CONSTRAINT FK_OL_Orders REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
  ProductId    INT           NOT NULL CONSTRAINT FK_OL_Products REFERENCES dbo.Products(ProductId),
  ColorId      INT           NOT NULL CONSTRAINT FK_OL_Colors REFERENCES dbo.ProductColors(ColorId),
  SizeCode     VARCHAR(5)    NOT NULL CONSTRAINT FK_OL_Sizes REFERENCES dbo.Sizes(SizeCode),
  Sleeve       VARCHAR(4)    NOT NULL CONSTRAINT CK_OL_Sleeve CHECK (Sleeve IN ('FULL','HALF')),
  Qty          INT           NOT NULL CONSTRAINT CK_OL_Qty CHECK (Qty > 0),
  UnitPrice    DECIMAL(10,2) NOT NULL,
  UnitMrp      DECIMAL(10,2) NOT NULL,
  LineAmount   AS (Qty * UnitPrice) PERSISTED,
  CONSTRAINT UQ_OL UNIQUE (OrderId, ColorId, SizeCode, Sleeve)
);
CREATE INDEX IX_OL_Product ON dbo.OrderLines(ProductId);
GO
CREATE TABLE dbo.OrderStatusLog (
  LogId        INT IDENTITY(1,1) CONSTRAINT PK_OrderStatusLog PRIMARY KEY,
  OrderId      INT          NOT NULL CONSTRAINT FK_OSL_Orders REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
  StatusCode   VARCHAR(12)  NOT NULL CONSTRAINT FK_OSL_Status REFERENCES dbo.OrderStatuses(StatusCode),
  ChangedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_OSL_At DEFAULT SYSUTCDATETIME(),
  ChangedBy    INT          NULL CONSTRAINT FK_OSL_Users REFERENCES dbo.Users(UserId),
  Note         NVARCHAR(200) NULL,
  CONSTRAINT UQ_OSL UNIQUE (OrderId, StatusCode)
);
GO

/* ── Collections ────────────────────────────────────────────────────── */
CREATE SEQUENCE dbo.ReceiptNoSeq AS INT START WITH 5001 INCREMENT BY 1;
GO
CREATE TABLE dbo.Payments (
  PaymentId    INT IDENTITY(1,1) CONSTRAINT PK_Payments PRIMARY KEY,
  ReceiptNo    VARCHAR(20)   NOT NULL CONSTRAINT UQ_Payments_Receipt UNIQUE,
  OutletId     INT           NOT NULL CONSTRAINT FK_Pay_Outlets REFERENCES dbo.Outlets(OutletId),
  UserId       INT           NOT NULL CONSTRAINT FK_Pay_Users REFERENCES dbo.Users(UserId),
  Amount       DECIMAL(14,2) NOT NULL CONSTRAINT CK_Pay_Amount CHECK (Amount > 0),
  Method       VARCHAR(10)   NOT NULL CONSTRAINT CK_Pay_Method CHECK (Method IN ('CASH','UPI','CHEQUE')),
  Reference    NVARCHAR(60)  NULL,
  CollectedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_Pay_At DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Pay_Outlet ON dbo.Payments(OutletId, CollectedAt DESC);
GO

/* ── Market survey ──────────────────────────────────────────────────── */
CREATE TABLE dbo.SurveySections (
  SectionCode  VARCHAR(20)   NOT NULL CONSTRAINT PK_SurveySections PRIMARY KEY,
  Title        NVARCHAR(60)  NOT NULL,
  Hint         NVARCHAR(200) NOT NULL,
  SortOrder    TINYINT       NOT NULL
);
GO
CREATE TABLE dbo.Surveys (
  SurveyId     INT IDENTITY(1,1) CONSTRAINT PK_Surveys PRIMARY KEY,
  OutletId     INT          NOT NULL CONSTRAINT FK_Sv_Outlets REFERENCES dbo.Outlets(OutletId),
  UserId       INT          NOT NULL CONSTRAINT FK_Sv_Users REFERENCES dbo.Users(UserId),
  CreatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_Sv_At DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE dbo.SurveyAnswers (
  SurveyId     INT            NOT NULL CONSTRAINT FK_SA_Surveys REFERENCES dbo.Surveys(SurveyId) ON DELETE CASCADE,
  SectionCode  VARCHAR(20)    NOT NULL CONSTRAINT FK_SA_Sections REFERENCES dbo.SurveySections(SectionCode),
  Answer       NVARCHAR(2000) NOT NULL,
  CONSTRAINT PK_SurveyAnswers PRIMARY KEY (SurveyId, SectionCode)
);
GO

/* ── Expenses ───────────────────────────────────────────────────────── */
CREATE TABLE dbo.ExpenseTypes (
  ExpenseType  VARCHAR(10)   NOT NULL CONSTRAINT PK_ExpenseTypes PRIMARY KEY,
  DailyLimit   DECIMAL(10,2) NOT NULL
);
GO
CREATE TABLE dbo.Expenses (
  ExpenseId     INT IDENTITY(1,1) CONSTRAINT PK_Expenses PRIMARY KEY,
  UserId        INT           NOT NULL CONSTRAINT FK_Exp_Users REFERENCES dbo.Users(UserId),
  ExpenseDate   DATE          NOT NULL,
  ExpenseType   VARCHAR(10)   NOT NULL CONSTRAINT FK_Exp_Types REFERENCES dbo.ExpenseTypes(ExpenseType),
  Amount        DECIMAL(10,2) NOT NULL CONSTRAINT CK_Exp_Amount CHECK (Amount > 0),
  LimitAmount   DECIMAL(10,2) NOT NULL,          -- snapshot of the limit at submission
  BillPath      NVARCHAR(260) NULL,
  Notes         NVARCHAR(300) NULL,
  Status        VARCHAR(10)   NOT NULL CONSTRAINT DF_Exp_Status DEFAULT 'PENDING' CONSTRAINT CK_Exp_Status CHECK (Status IN ('PENDING','APPROVED','REJECTED')),
  ManagerRemark NVARCHAR(300) NULL,
  ActionedBy    INT           NULL CONSTRAINT FK_Exp_ActionedBy REFERENCES dbo.Users(UserId),
  ActionedAt    DATETIME2(0)  NULL,
  CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Exp_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Exp_UserDate ON dbo.Expenses(UserId, ExpenseDate DESC);
GO

/* ── Targets & incentives ───────────────────────────────────────────── */
CREATE TABLE dbo.SalesTargets (
  UserId        INT           NOT NULL CONSTRAINT FK_ST_Users REFERENCES dbo.Users(UserId),
  TargetYear    SMALLINT      NOT NULL,
  TargetMonth   TINYINT       NOT NULL CONSTRAINT CK_ST_Month CHECK (TargetMonth BETWEEN 1 AND 12),
  MonthlyTarget DECIMAL(14,2) NOT NULL,
  WorkingDays   TINYINT       NOT NULL CONSTRAINT DF_ST_Days DEFAULT 26,
  CONSTRAINT PK_SalesTargets PRIMARY KEY (UserId, TargetYear, TargetMonth)
);
GO
CREATE TABLE dbo.IncentiveSlabs (
  SlabId       INT IDENTITY(1,1) CONSTRAINT PK_IncentiveSlabs PRIMARY KEY,
  UptoPct      INT           NOT NULL CONSTRAINT UQ_IS_Upto UNIQUE,
  RatePct      DECIMAL(4,2)  NOT NULL,
  Label        NVARCHAR(30)  NOT NULL
);
GO

/* ── Live tracking & notifications ─────────────────────────────────── */
CREATE TABLE dbo.GpsPoints (
  GpsPointId   BIGINT IDENTITY(1,1) CONSTRAINT PK_GpsPoints PRIMARY KEY,
  UserId       INT           NOT NULL CONSTRAINT FK_GPS_Users REFERENCES dbo.Users(UserId),
  CapturedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_GPS_At DEFAULT SYSUTCDATETIME(),
  Latitude     DECIMAL(9,6)  NOT NULL,
  Longitude    DECIMAL(9,6)  NOT NULL,
  Label        NVARCHAR(120) NULL,
  IsDeviation  BIT           NOT NULL CONSTRAINT DF_GPS_Dev DEFAULT 0
);
CREATE INDEX IX_GPS_UserAt ON dbo.GpsPoints(UserId, CapturedAt DESC);
GO
CREATE TABLE dbo.Notifications (
  NotificationId INT IDENTITY(1,1) CONSTRAINT PK_Notifications PRIMARY KEY,
  UserId       INT           NOT NULL CONSTRAINT FK_Ntf_Users REFERENCES dbo.Users(UserId),
  Icon         NVARCHAR(8)   NOT NULL,
  Title        NVARCHAR(100) NOT NULL,
  Body         NVARCHAR(300) NOT NULL,
  Tone         VARCHAR(10)   NOT NULL CONSTRAINT DF_Ntf_Tone DEFAULT 'blue',
  Link         VARCHAR(100)  NULL,
  IsRead       BIT           NOT NULL CONSTRAINT DF_Ntf_Read DEFAULT 0,
  CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Ntf_At DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Ntf_User ON dbo.Notifications(UserId, IsRead, CreatedAt DESC);
GO

/* ── Sample pads (Salesforce "Sample Pad" object) ──────────────────── */
CREATE TABLE dbo.DeliveryChallans (
  DcId         INT IDENTITY(1,1) CONSTRAINT PK_DeliveryChallans PRIMARY KEY,
  DcNo         VARCHAR(30)  NOT NULL CONSTRAINT UQ_DC_No UNIQUE,
  DcDate       DATE         NOT NULL,
  UserId       INT          NOT NULL CONSTRAINT FK_DC_Users REFERENCES dbo.Users(UserId),
  CreatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_DC_At DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_DC_User ON dbo.DeliveryChallans(UserId, DcDate DESC);
GO
CREATE TABLE dbo.SamplePads (
  SamplePadId  INT IDENTITY(1,1) CONSTRAINT PK_SamplePads PRIMARY KEY,
  RecordNo     AS ('SP-' + CAST(SamplePadId + 1000 AS VARCHAR(10))) PERSISTED,
  DcId         INT           NOT NULL CONSTRAINT FK_SP_DC REFERENCES dbo.DeliveryChallans(DcId),
  ItemCode     VARCHAR(20)   NOT NULL,
  PadName      NVARCHAR(120) NOT NULL,
  Subgroup     NVARCHAR(40)  NOT NULL,
  Qty          INT           NOT NULL CONSTRAINT CK_SP_Qty CHECK (Qty > 0),
  AckAt        DATETIME2(0)  NULL,
  AckVia       VARCHAR(12)   NULL CONSTRAINT CK_SP_Via CHECK (AckVia IN ('QR_SCAN','PHOTO_SCAN')),
  Remarks      NVARCHAR(300) NULL,
  RemindedAt   DATETIME2(0)  NULL,
  CONSTRAINT UQ_SP_Item UNIQUE (DcId, ItemCode)
);
GO
