import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from '../../core/api.service';
import { Beat, Plan } from '../../core/models';

/** Shared state for the journey-plan screens (current month). */
@Injectable({ providedIn: 'root' })
export class PlanStore {
  private api = inject(Api);
  readonly plan = signal<Plan | null>(null);
  readonly beats = signal<Beat[]>([]);
  readonly byId = computed(() => new Map(this.beats().map(b => [b.id, b])));

  async load() {
    const [plan, beats] = await Promise.all([this.api.get<Plan>('/plans'), this.api.get<Beat[]>('/beats')]);
    this.plan.set(plan);
    this.beats.set(beats);
    return plan;
  }
  async saveDays(days: { day: number; beatId: number }[]) {
    const p = await this.api.put<Plan>(`/plans/${this.plan()!.id}/days`, { days });
    this.plan.set(p);
    this.beats.set(await this.api.get<Beat[]>('/beats'));
  }
  async submit() { this.plan.set(await this.api.post<Plan>(`/plans/${this.plan()!.id}/submit`)); }
}
