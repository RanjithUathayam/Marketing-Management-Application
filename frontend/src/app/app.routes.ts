import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/guards';

const EXEC = { roles: ['EXEC'] };
const MGR = { roles: ['MANAGER', 'ADMIN'] };
const exec = (nav: string | null) => ({ ...EXEC, nav });
const mgr = (nav: string | null, wide = false) => ({ ...MGR, nav, wide });
const any = (nav: string | null) => ({ roles: ['EXEC', 'MANAGER', 'ADMIN'], nav });

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login').then(m => m.LoginPage) },
  {
    path: '', canActivate: [authGuard], canActivateChild: [roleGuard],
    children: [
      { path: 'start-day', data: exec(null), loadComponent: () => import('./features/auth/start-day').then(m => m.StartDayPage) },
      { path: 'home', data: exec('home'), loadComponent: () => import('./features/exec/home').then(m => m.HomePage) },
      { path: 'attendance', data: exec(null), loadComponent: () => import('./features/exec/attendance').then(m => m.AttendancePage) },
      { path: 'work', data: exec('work'), loadComponent: () => import('./features/exec/work').then(m => m.WorkPage) },
      { path: 'work/check/:type', data: exec('work'), loadComponent: () => import('./features/exec/work').then(m => m.CheckInOutPage) },
      { path: 'route', data: exec('route'), loadComponent: () => import('./features/exec/route-plan').then(m => m.RoutePlanPage) },
      { path: 'route/build', data: exec('route'), loadComponent: () => import('./features/exec/route-plan').then(m => m.RouteBuildPage) },
      { path: 'route/review', data: exec('route'), loadComponent: () => import('./features/exec/route-plan').then(m => m.RouteReviewPage) },
      { path: 'route/status', data: exec('route'), loadComponent: () => import('./features/exec/route-plan').then(m => m.RouteStatusPage) },
      { path: 'outlets', data: exec('work'), loadComponent: () => import('./features/exec/outlets').then(m => m.OutletsPage) },
      { path: 'outlets/new', data: exec('work'), loadComponent: () => import('./features/exec/new-outlet').then(m => m.NewOutletPage) },
      { path: 'order', data: exec(null), loadComponent: () => import('./features/order/order-select').then(m => m.OrderSelectPage) },
      { path: 'order/matrix', data: exec(null), loadComponent: () => import('./features/order/order-matrix').then(m => m.OrderMatrixPage) },
      { path: 'order/summary', data: exec(null), loadComponent: () => import('./features/order/order-checkout').then(m => m.OrderSummaryPage) },
      { path: 'order/transport', data: exec(null), loadComponent: () => import('./features/order/order-checkout').then(m => m.OrderTransportPage) },
      { path: 'order/success/:id', data: exec(null), loadComponent: () => import('./features/order/order-checkout').then(m => m.OrderSuccessPage) },
      { path: 'orders', data: any('orders'), loadComponent: () => import('./features/order/order-status').then(m => m.OrderStatusPage) },
      { path: 'orders/:id', data: any(null), loadComponent: () => import('./features/order/order-status').then(m => m.OrderDetailPage) },
      { path: 'survey/:outletId', data: exec('work'), loadComponent: () => import('./features/exec/field').then(m => m.SurveyPage) },
      { path: 'payment/:outletId', data: exec('work'), loadComponent: () => import('./features/exec/field').then(m => m.PaymentPage) },
      { path: 'expenses', data: exec('reports'), loadComponent: () => import('./features/exec/field').then(m => m.ExpensePage) },
      { path: 'tracking', data: exec('reports'), loadComponent: () => import('./features/exec/insights').then(m => m.TrackingPage) },
      { path: 'targets', data: exec('reports'), loadComponent: () => import('./features/exec/insights').then(m => m.TargetsPage) },
      { path: 'reports', data: exec('reports'), loadComponent: () => import('./features/exec/insights').then(m => m.ReportsPage) },
      { path: 'customers', data: any('profile'), loadComponent: () => import('./features/exec/masters').then(m => m.CustomersPage) },
      { path: 'products', data: any('profile'), loadComponent: () => import('./features/exec/masters').then(m => m.ProductsPage) },
      { path: 'sample-pads', data: exec('home'), loadComponent: () => import('./features/samplepads/my-sample-pads').then(m => m.MySamplePadsPage) },
      { path: 'notifications', data: any(null), loadComponent: () => import('./features/exec/masters').then(m => m.NotificationsPage) },
      { path: 'profile', data: any('profile'), loadComponent: () => import('./features/exec/masters').then(m => m.ProfilePage) },

      { path: 'manager', data: mgr('mgr-home'), loadComponent: () => import('./features/manager/manager-home').then(m => m.ManagerHomePage) },
      { path: 'manager/team', data: mgr('mgr-team'), loadComponent: () => import('./features/manager/manager-team').then(m => m.ManagerTeamPage) },
      { path: 'manager/track', data: mgr('mgr-track'), loadComponent: () => import('./features/manager/manager-team').then(m => m.ManagerTrackPage) },
      { path: 'manager/reports', data: mgr('mgr-reports'), loadComponent: () => import('./features/manager/manager-team').then(m => m.ManagerReportsPage) },
      { path: 'manager/approvals', data: mgr('mgr-approve'), loadComponent: () => import('./features/manager/approvals').then(m => m.ApprovalsPage) },
      { path: 'manager/plans/:id', data: mgr('mgr-approve'), loadComponent: () => import('./features/manager/approvals').then(m => m.PlanReviewPage) },
      { path: 'manager/sample-pads', data: mgr(null, true), loadComponent: () => import('./features/samplepads/sample-pad-object').then(m => m.SamplePadObjectPage) },
      { path: 'admin/users', data: { roles: ['ADMIN'], nav: null, wide: true }, loadComponent: () => import('./features/manager/admin-users').then(m => m.AdminUsersPage) },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
