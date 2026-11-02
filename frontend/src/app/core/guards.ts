import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).parseUrl('/login');
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).parseUrl(auth.home()) : true;
};

/** Route data: { roles: Role[], phone?: true }. A phone order session (no OTP) only opens routes marked phone.
    The API enforces the same rules server-side. */
export const roleGuard: CanActivateFn = route => {
  const auth = inject(AuthService);
  const roles = (route.data['roles'] ?? []) as Role[];
  const role = auth.role();
  const allowed = role && roles.includes(role) && (!auth.isPhoneOrder() || route.data['phone'] === true);
  return allowed ? true : inject(Router).parseUrl(auth.home());
};
