import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const withToken = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/** Adds the bearer token; on 401 refreshes once and retries, otherwise signs out. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (/\/auth\/(otp|refresh|logout)/.test(req.url)) return next(req);
  return next(withToken(req, auth.accessToken)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap(token => {
          if (!token) {
            router.navigateByUrl('/login');
            return throwError(() => err);
          }
          return next(withToken(req, token));
        }),
      );
    }),
  );
};
