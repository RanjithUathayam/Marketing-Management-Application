import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard, roleGuard } from './guards';

const session = (role: string) =>
  localStorage.setItem('mma.session', JSON.stringify({ accessToken: 'a', refreshToken: 'r', user: { id: 1, name: 'X', role, empCode: 'E', mobile: '9', manager: null } }));
const phoneSession = () =>
  localStorage.setItem('mma.session', JSON.stringify({ accessToken: 'a', refreshToken: null, scope: 'PHONE_ORDER', user: { id: 1, name: 'X', role: 'EXEC', empCode: 'E', mobile: '9', manager: null } }));
const snap = (roles: string[], phone = false) => ({ data: { roles, phone } }) as unknown as ActivatedRouteSnapshot;
const run = (g: typeof roleGuard, roles: string[] = [], phone = false) =>
  TestBed.runInInjectionContext(() => g(snap(roles, phone), {} as RouterStateSnapshot));

describe('route guards', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient()] });
  });

  it('sends anonymous users to /login', () => {
    expect((run(authGuard) as UrlTree).toString()).toBe('/login');
  });
  it('lets an executive into executive routes and redirects managers home', () => {
    session('EXEC');
    expect(run(roleGuard, ['EXEC'])).toBe(true);
    expect((run(roleGuard, ['MANAGER', 'ADMIN']) as UrlTree).toString()).toBe('/home');
  });
  it('sends managers to the manager console', () => {
    session('MANAGER');
    expect((run(roleGuard, ['EXEC']) as UrlTree).toString()).toBe('/manager');
  });
  it('keeps a phone order session (no sign-in) inside the phone order routes', () => {
    phoneSession();
    expect(run(roleGuard, ['EXEC'], true)).toBe(true);
    expect((run(roleGuard, ['EXEC']) as UrlTree).toString()).toBe('/outlets?task=phone');
  });
});
