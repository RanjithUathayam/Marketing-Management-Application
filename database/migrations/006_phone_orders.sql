/* Phone orders: an order taken over a call with the outlet, without visiting it.
   - OrderChannel: VISIT (taken at the outlet, signed by the customer) or PHONE.
   - Phone orders record who confirmed the order on the call instead of a signature,
     and are not counted as an outlet visit or checked against the geofence. */
ALTER TABLE dbo.Orders ADD
  OrderChannel  VARCHAR(5)   NOT NULL CONSTRAINT DF_Orders_Channel DEFAULT 'VISIT'
                             CONSTRAINT CK_Orders_Channel CHECK (OrderChannel IN ('VISIT','PHONE')),
  CallerName    NVARCHAR(80) NULL,
  CallerMobile  VARCHAR(10)  NULL;
GO
ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_PhoneCaller CHECK (OrderChannel = 'VISIT' OR CallerName IS NOT NULL);
GO
