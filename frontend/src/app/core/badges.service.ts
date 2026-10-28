import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { AuthService } from './auth.service';
import { ApprovalCounts, OrderList } from './models';

/** Counts shown on bottom-nav badges; refreshed after navigation (at most every 20 s) or on demand. */
@Injectable({ providedIn: 'root' })
export class Badges {
  private api = inject(Api);
  private auth = inject(AuthService);
  readonly ordersInProgress = signal(0);
  readonly approvals = signal(0);
  private lastAt = 0;

  async refresh(force = false) {
    if (!this.auth.isLoggedIn() || (!force && Date.now() - this.lastAt < 20000)) return;
    this.lastAt = Date.now();
    try {
      if (this.auth.isManager()) {
        this.approvals.set((await this.api.get<ApprovalCounts>('/approvals/summary')).total);
      } else {
        const r = await this.api.get<OrderList>('/orders', { pageSize: 1 });
        this.ordersInProgress.set(Object.entries(r.statusCounts).filter(([k]) => k !== 'COMPLETED').reduce((s, [, n]) => s + (n ?? 0), 0));
      }
    } catch { /* badges are best-effort */ }
  }
}
