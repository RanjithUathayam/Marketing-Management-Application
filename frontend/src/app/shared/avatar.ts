import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { initials } from '../core/format';

/** Signed-in user's avatar: their admin-added profile photo, or their initials until one exists. */
@Component({
  selector: 'app-avatar',
  host: { class: 'av' },
  template: `@if (auth.photoUrl(); as p) { <img [src]="p" [alt]="name()"> } @else { {{ ini() }} }`,
})
export class Avatar {
  auth = inject(AuthService);
  name = computed(() => this.auth.user()?.name ?? '');
  ini = computed(() => initials(this.name()));
}
