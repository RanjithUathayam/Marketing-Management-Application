/* ═══════════════════════════════════════════════════════════════════════
   Selfie attendance with face verification.
   • Employee master gets a profile photo + its face template (128-d descriptor, JSON).
   • Every verification attempt is a one-time challenge row (anti-replay, audit trail).
   • An attendance day records which passed verification it consumed.
   Photo/selfie columns hold storage keys inside SECURE_UPLOAD_DIR, never public URLs.
   ═══════════════════════════════════════════════════════════════════════ */

ALTER TABLE dbo.Users ADD
  ProfilePhotoPath      NVARCHAR(260) NULL,
  FaceDescriptor        VARCHAR(MAX)  NULL,
  ProfilePhotoUpdatedAt DATETIME2(0)  NULL,
  ProfilePhotoUpdatedBy INT           NULL CONSTRAINT FK_Users_PhotoBy REFERENCES dbo.Users(UserId);
GO

CREATE TABLE dbo.FaceVerifications (
  FaceVerificationId INT IDENTITY(1,1) CONSTRAINT PK_FaceVerifications PRIMARY KEY,
  UserId           INT           NOT NULL CONSTRAINT FK_FV_Users REFERENCES dbo.Users(UserId),
  Purpose          VARCHAR(20)   NOT NULL CONSTRAINT DF_FV_Purpose DEFAULT 'START_DAY',
  TurnDirection    VARCHAR(5)    NOT NULL CONSTRAINT CK_FV_Dir CHECK (TurnDirection IN ('LEFT','RIGHT')),
  Status           VARCHAR(20)   NOT NULL CONSTRAINT DF_FV_Status DEFAULT 'ISSUED'
                   CONSTRAINT CK_FV_Status CHECK (Status IN ('ISSUED','PROCESSING','PASSED','MISMATCH','NO_FACE','MULTIPLE_FACES',
                                                             'LIVENESS_FAILED','EXPIRED','CONSUMED')),
  ProfilePhotoAt   DATETIME2(0)  NULL,          -- version of the registered photo compared against
  MatchDistance    DECIMAL(6,4)  NULL,          -- lower = more similar; threshold is FACE_MATCH_THRESHOLD
  SelfiePath       NVARCHAR(260) NULL,
  IssuedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_FV_Issued DEFAULT SYSUTCDATETIME(),
  ExpiresAt        DATETIME2(0)  NOT NULL,
  VerifiedAt       DATETIME2(0)  NULL,
  ConsumedAt       DATETIME2(0)  NULL,
  ClientIp         VARCHAR(45)   NULL,
  UserAgent        NVARCHAR(300) NULL
);
CREATE INDEX IX_FV_User ON dbo.FaceVerifications(UserId, IssuedAt DESC);
GO

ALTER TABLE dbo.AttendanceDays ADD
  FaceVerificationId INT NULL CONSTRAINT FK_AD_FaceVerification REFERENCES dbo.FaceVerifications(FaceVerificationId);
GO
CREATE UNIQUE INDEX UX_AD_FaceVerification ON dbo.AttendanceDays(FaceVerificationId) WHERE FaceVerificationId IS NOT NULL;
GO
