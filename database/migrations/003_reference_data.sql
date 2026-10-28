/* Reference data required by the application (not demo data). */
INSERT dbo.Roles (RoleCode, RoleName) VALUES
  ('EXEC', N'Sales Executive'), ('MANAGER', N'Manager'), ('ADMIN', N'Administrator');

INSERT dbo.Sizes (SizeCode, SortOrder) VALUES ('36',1),('38',2),('40',3),('42',4),('44',5),('46',6);

INSERT dbo.OrderStatuses (StatusCode, Label, SortOrder) VALUES
  ('RECEIVED',N'Order Received',1), ('APPROVED',N'Approved',2), ('DELIVERED',N'Delivered',3),
  ('INVOICED',N'Invoiced',4), ('DISPATCHED',N'Dispatched',5), ('COMPLETED',N'Completed',6);

INSERT dbo.ExpenseTypes (ExpenseType, DailyLimit) VALUES ('FUEL',800),('FOOD',250),('STAY',1200),('MISC',500);

INSERT dbo.IncentiveSlabs (UptoPct, RatePct, Label) VALUES
  (80,0,N'Below 80%'), (100,1.2,N'80–100%'), (120,2.0,N'100–120%'), (999,2.8,N'120%+');

INSERT dbo.SurveySections (SectionCode, Title, Hint, SortOrder) VALUES
  ('PRODUCT_STOCK', N'📦 Product & Stock',        N'Availability, placement, visibility, promotions running',1),
  ('PRICING',       N'🏷️ Pricing',                N'Your selling price vs competitor prices, discounts & schemes',2),
  ('COMPETITOR',    N'🥊 Competitor',             N'Competitor products, pricing, shelf placement & visibility',3),
  ('FEEDBACK',      N'💬 Customer Feedback',      N'Preferences, complaints, demand for new products',4),
  ('PROMOTION',     N'📣 Promotion Effectiveness',N'Which offers work, customer response, competitor impact',5),
  ('BUYING',        N'🔁 Buying Patterns',        N'Frequently purchased, qty per purchase, brand preference',6),
  ('SCHEME',        N'🎁 Scheme Awareness',       N'Retailer awareness of company schemes',7);
GO
