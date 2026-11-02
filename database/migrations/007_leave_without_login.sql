/* Leave / permission requests can be filed from the login page without signing in.
   The employee identifies themselves with mobile number + Employee ID; such requests are flagged
   so the approving manager knows the request was not made from a signed-in session. */
ALTER TABLE dbo.LeaveRequests ADD
  AppliedVia VARCHAR(10) NOT NULL CONSTRAINT DF_LR_AppliedVia DEFAULT 'APP'
             CONSTRAINT CK_LR_AppliedVia CHECK (AppliedVia IN ('APP','LOGIN_PAGE'));
GO
