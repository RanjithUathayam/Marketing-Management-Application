import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard, roleGuard } from './guards';

const session = (role: string) =>
  localStorage.setItem('mma.session', JSON.stringify({ accessToken: 'a', refreshToken: 'r', user: { id: 1, name: 'X', role, empCode: 'E', mobile: '9', manager: null } }));
const snap = (roles: string[]) => ({ data: { roles } }) as unknown as ActivatedRouteSnapshot;
const run = (g: typeof roleGuard, roles: string[] = []) =>
  TestBed.runInInjectionContext(() => g(snap(roles), {} as RouterStateSnapshot));

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
});
