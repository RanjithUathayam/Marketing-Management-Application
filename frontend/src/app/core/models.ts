export type Role = 'EXEC' | 'MANAGER' | 'ADMIN';

export interface User {
  id: number; empCode: string; name: string; mobile: string; email?: string | null; role: Role;
  designation?: string | null; region?: string | null; territory?: string | null;
  manager: { id: number; name: string; designation?: string | null } | null;
}
export interface AuthResponse { accessToken: string; refreshToken: string; user: User }
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface VisitIndicator { code: string; tone: 'nv' | 'v1' | 'v2' | 'v3' | 'v4'; label: string }
export interface Priority { rank: number; group: 'nv' | 'must' | 'ok'; reasons: string[] }
export interface BeatVisit { date: string; visited: number; ordered: number }
export interface Beat {
  id: number; code: string; name: string; area: string; colorTag: 'green' | 'teal' | 'amber';
  outlets: number; mix: { a: number; b: number; c: number };
  monthVisits: BeatVisit[]; visitCount: number; indicator: VisitIndicator; group: 'nv' | 'mv' | 'vs';
  lastVisit: (BeatVisit & { previousMonth: boolean }) | null;
  productiveCalls: { pct: number; level: 'hi' | 'mid' | 'low' } | null;
  plannedToday: boolean; plannedDays: number; priority: Priority;
}
export interface InsightStrip { nv: number; mv: number; vs: number; mustVisit: number; lowCalls: number }

export type PlanStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'SENTBACK';
export interface Plan {
  id: number; userId: number; userName: string; empCode: string; year: number; month: number; status: PlanStatus;
  managerNote: string | null; submittedAt: string | null; actionedAt: string | null; actionedBy: string | null; createdAt: string;
  days: { day: number; beatId: number }[]; stats: { days: number; beats: number; outlets: number };
  beats?: Beat[]; insights?: InsightStrip;
}
export interface BeatChange {
  id: number; userId: number; userName: string; fromBeatId: number; fromBeat: string; toBeatId: number; toBeat: string;
  forDate: string; remarks: string; status: string; managerRemark: string | null; createdAt: string;
  from?: Beat; to?: Beat; insights?: InsightStrip;
}

export type Performance = 'nonorder' | 'outstanding' | 'recent' | 'ok';
export interface Outlet {
  id: number; name: string; owner: string; mobile: string; type: string; beatId: number; beatCode: string; beatName: string; area: string;
  outletClass: 'A' | 'B' | 'C'; grade: number; creditLimit: number; outstanding: number; lastMonthSales: number; lastOrderAt: string | null;
  performance: Performance; gstin: string | null; pan: string | null;
  address: { building: string | null; line: string; city: string; district: string | null; state: string; postalCode: string };
  lat: number | null; lng: number | null; distanceKm: number | null; visitedToday: boolean; status: string; approvalRemark: string | null;
  createdBy: string | null; createdAt: string; documents?: { type: string; url: string }[];
  payments?: { receiptNo: string; amount: number; method: string; collectedAt: string }[];
}

export interface Product {
  id: number; code: string; qrCode: string; name: string; icon: string; category: 'shirt' | 'fabric' | 'trouser';
  brand: string; subBrand: string; factoryRate: number; halfRate: number; mrp: number;
  scheme: { text: string; buyQty: number; freeQty: number } | null; altProductId: number | null; moq: number;
  nonReturnable: boolean; tag: string | null; hasSleeves: boolean; colorCount: number; stockQty: number;
  stockBand: { tone: 'red' | 'orange' | 'yellow' | 'green'; label: string }; frequent: boolean;
}
export type StockStatus = 'STOPPED' | 'IN_STOCK' | 'OOS_15' | 'REFILL_13' | 'REFILL_30';
export interface ProductColor { id: number; code: string; name: string; hex: string; isCore: boolean; stock: Record<string, StockStatus> }
export interface MatrixProduct extends Product { colors: ProductColor[] }
export interface Matrix { sizes: string[]; products: MatrixProduct[]; stockStatuses: Record<StockStatus, { tone: string; label: string; orderable: boolean }> }

export type Sleeve = 'FULL' | 'HALF';
export interface OrderLineInput { productId: number; colorId: number; size: string; sleeve: Sleeve; qty: number }
export interface Quote {
  lines: (OrderLineInput & { unitPrice: number; unitMrp: number; amount: number; stockStatus: StockStatus })[];
  products: { productId: number; productName: string; qty: number; amount: number; freeQty: number }[];
  subTotal: number; mrpValue: number; schemeValue: number; taxAmount: number; totalAmount: number; totalPieces: number;
  credit: { outstanding: number; creditLimit: number; exceeds: boolean };
}
export type OrderStatus = 'RECEIVED' | 'APPROVED' | 'DELIVERED' | 'INVOICED' | 'DISPATCHED' | 'COMPLETED';
export interface Order {
  id: number; orderNo: string; outletId: number; outletName: string; beatCode: string; beatName: string;
  userId: number; execName: string; empCode: string; orderedAt: string;
  subTotal: number; mrpValue: number; schemeValue: number; taxAmount: number; totalAmount: number; totalPieces: number; productCount: number;
  paymentTerms: string; instructions: string | null; signatureUrl: string | null;
  transport: { mode: string; transporter: string; destination: string; deliveryDate: string };
  status: OrderStatus; creditHold: boolean; invoiceNo: string | null; lrNo: string | null; receivedBy: string | null;
  log: { status: OrderStatus; at: string; by?: string; note?: string }[];
  products?: { productId: number; name: string; icon: string; qty: number; amount: number; freeQty: number; colors: string[];
    lines: { color: string; hex: string; size: string; sleeve: Sleeve; qty: number; unitPrice: number; amount: number }[] }[];
}
export interface OrderList extends Paged<Order> { totalAmount: number; statusCounts: Partial<Record<OrderStatus, number>> }

export interface AttendanceToday {
  date: string; dayStarted: boolean; dayEnded: boolean;
  day: { travelMode: string; odoStart: number | null; odoEnd: number | null; isLate: boolean; startedAt: string; endedAt: string | null; selfie: string | null } | null;
  openSession: { SessionId: number; CheckInAt: string; CheckOutAt: null } | null;
  sessions: { SessionId: number; CheckInAt: string; CheckOutAt: string | null }[];
}
export interface LeaveRequest { id: number; kind: string; leaveType: string; fromDate: string; toDate: string; reason: string; status: string;
  managerRemark?: string | null; createdAt: string; userId?: number; userName?: string; hours?: number | null }
export interface Regularization { id: number; date: string; reason: string; status: string; managerRemark?: string | null; userName?: string }
export interface AttendanceCalendar {
  year: number; month: number; days: { day: number; date: string; status: 'present' | 'late' | 'leave' | 'absent' | 'off' | null }[];
  summary: { present: number; late: number; leave: number; absent: number };
  leaveStatus: { approved: number; pending: number; rejected: number };
  leaves: LeaveRequest[]; regularizations: Regularization[];
}

export interface Expense { id: number; userId: number; userName: string; date: string; type: string; amount: number; limit: number;
  overLimit: boolean; billUrl: string | null; notes: string | null; status: string; managerRemark: string | null; createdAt: string }

export interface TargetSummary {
  year: number; month: number; monthlyTarget: number; achieved: number; achievedPct: number; balance: number;
  workingDays: number; elapsedWorkingDays: number; daysLeft: number;
  daily: { target: number; achieved: number; pct: number }; weekly: { target: number; achieved: number; pct: number };
  quarterly: { target: number; achieved: number; pct: number };
  incentive: { slab: Slab | null; earned: number; slabs: Slab[]; nextSlab: Slab | null }; hasTarget: boolean;
}
export interface Slab { uptoPct: number; ratePct: number; label: string }

export interface ExecDashboard {
  todayBeat: { id: number; code: string; name: string; area: string; outlets: number; visited: number; pending: number; planned: boolean } | null;
  todaySales: number; salesVsAvgPct: number | null; outstanding: number; highOutstandingOutlets: number;
  target: { pct: number; achieved: number; monthly: number; balance: number; daysLeft: number };
  recentOrders: { id: number; orderNo: string; orderedAt: string; totalAmount: number; status: OrderStatus; outletName: string; items: number }[];
  samplePads: { pending: number; dcs: number }; unreadNotifications: number;
}
export interface TeamMember { id: number; name: string; empCode: string; territory: string; target: number; sales: number;
  achievedPct: number; rank: 'top' | 'avg' | 'low'; status: 'active' | 'idle'; lastSeenAt: string | null; attendance?: string }
export interface PadTeamRow { userId: number; name: string; empCode: string; issued: number; acknowledged: number; pending: number }
export interface ManagerDashboard {
  teamSalesMtd: number; salesTrendPct: number | null; teamTargetPct: number; activeNow: number; teamSize: number; pendingApprovals: number;
  beatChangeTrend: { userId: number; name: string; count: number; unusual: boolean }[];
  team: TeamMember[]; beats: Beat[]; samplePads: PadTeamRow[];
}
export interface ApprovalCounts { plans: number; beatChanges: number; expenses: number; leaves: number; regularizations: number; creditOrders: number; outlets: number; total: number }

export interface SamplePad {
  id: number; recordNo: string; itemCode: string; name: string; subgroup: string; qty: number; dcNo: string; dcDate: string;
  userId: number; empCode: string; employee: string; status: 'ACKNOWLEDGED' | 'PENDING'; ackAt: string | null; ackVia: string | null;
  remarks: string | null; remindedAt: string | null; qr: string;
}
export interface MySamplePads { employee: { id: number; empCode: string; name: string }; dcs: { dcNo: string; dcDate: string; items: SamplePad[] }[];
  issued: number; acknowledged: number; pending: number }
export interface Notification { id: number; icon: string; title: string; body: string; tone: string; link: string | null; isRead: boolean; createdAt: string }
export interface TrackingToday { points: { at: string; lat: number; lng: number; label: string | null; deviation: boolean }[];
  visits: number; distanceKm: number; activeMinutes: number; gpsActive: boolean; deviations: number; outletsPending: number }
export interface WorkLog { id: number; type: string; place: string | null; joinedUser: string | null; notes: string | null; checkInAt: string; checkOutAt: string | null; minutes: number | null }
