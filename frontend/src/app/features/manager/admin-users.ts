import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { AuthService } from '../../core/auth.service';
import { Role } from '../../core/models';
import { fmtDT } from '../../core/format';
import { AppBar, Sheet, StateView } from '../../shared/ui.components';
import { SelfieCamera, SelfieCapture } from '../../shared/selfie-camera';

interface AdminUser { id: number; empCode: string; name: string; mobile: string; email: string | null; role: Role; designation: string | null;
  region: string | null; territory: string | null; managerId: number | null; managerName: string | null; isActive: boolean; beatIds: number[];
  hasPhoto: boolean; photoUpdatedAt: string | null }
interface AdminBeat { id: number; code: string; name: string; area: string; outlets: number }
const blank = (): Omit<AdminUser, 'id' | 'managerName' | 'beatIds' | 'hasPhoto' | 'photoUpdatedAt'> & { id: number | null } =>
  ({ id: null, empCode: '', name: '', mobile: '', email: '', role: 'EXEC', designation: 'DSR', region: '', territory: '', managerId: null, isActive: true });

/** ADMIN: users, roles, reporting lines and beat assignment. */
@Component({
  selector: 'app-admin-users',
  imports: [FormsModule, AppBar, Sheet, StateView, SelfieCamera],
  host: { class: 'sc' },
  template: `
    <app-bar title="Users & Beats" sub="Administration" fallback="/profile">
      <button class="bar-preview" type="button" (click)="edit(null)">＋ New user</button>
    </app-bar>
    <div class="srch"><div class="sbox"><span>🔍</span><input [(ngModel)]="q" (ngModelChange)="load()" placeholder="Search name, emp code, mobile…" aria-label="Search users"></div></div>
    <div class="body">
      <app-state [loading]="!users() && !err()" [error]="err()" (retry)="load()">
        <div style="overflow-x:auto"><table class="dtbl">
          <thead><tr><th>Emp code</th><th>Name</th><th>Role</th><th>Mobile</th><th>Reports to</th><th>Beats</th><th>Photo</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (u of users() ?? []; track u.id) {
              <tr><td>{{ u.empCode }}</td><td><b>{{ u.name }}</b><div class="tiny">{{ u.designation }} · {{ u.territory || u.region }}</div></td>
                <td><span class="chip xs" [class.c-green]="u.role === 'EXEC'" [class.c-blue]="u.role === 'MANAGER'" [class.c-purple]="u.role === 'ADMIN'">{{ u.role }}</span></td>
                <td>{{ u.mobile }}</td><td>{{ u.managerName || '—' }}</td><td>{{ beatCodes(u.beatIds) }}</td>
                <td><span class="chip xs" [class.c-green]="u.hasPhoto" [class.c-amber]="!u.hasPhoto">{{ u.hasPhoto ? '✓ Added' : 'Missing' }}</span></td>
                <td><span class="chip xs" [class.c-green]="u.isActive" [class.c-grey]="!u.isActive">{{ u.isActive ? 'Active' : 'Inactive' }}</span></td>
                <td><button type="button" class="pillbtn" (click)="edit(u)">Edit</button></td></tr>
            }
          </tbody>
        </table></div>
      </app-state>
    </div>
    <app-sheet [(open)]="open" [heading]="f.id ? 'Edit user' : 'New user'" subheading="Login is by mobile number + OTP">
      <div class="fld"><label>Profile photo <span class="tiny">(used to verify the selfie attendance punch)</span></label>
        <div class="row" style="gap:14px;align-items:center">
            <div class="photo-box" [class.done]="!!photoUrl()" style="width:84px;height:84px;border-radius:50%;flex-shrink:0;cursor:default;font-size:30px">
              @if (photoUrl()) { <img [src]="photoUrl()" [alt]="'Profile photo of ' + f.name"> } @else { 👤 }
            </div>
            <div>
              <div class="wrap">
                <button type="button" class="pillbtn" [disabled]="photoBusy()" (click)="camera.set(true)">📷 Take photo</button>
                <label class="pillbtn" [class.on]="false" style="display:inline-flex;cursor:pointer" [attr.aria-disabled]="photoBusy()">
                  📤 Upload photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden [disabled]="photoBusy()" (change)="uploadPhoto($event)">
                </label>
              </div>
              <div class="tiny mt8">
                @if (photoBusy()) { Checking photo… · }
                @else if (!f.id && pendingPhoto) { Will be saved with the user · }
                @else if (photoUpdatedAt()) { Updated {{ fmtDT(photoUpdatedAt()) }} · }
                A clear, front-facing photo showing only the employee.</div>
            </div>
          </div>
      </div>
      <div class="no-2col">
        <div class="fld"><label for="ue">Emp code</label><input id="ue" [(ngModel)]="f.empCode" maxlength="20"></div>
        <div class="fld"><label for="ur">Role</label><select id="ur" [(ngModel)]="f.role"><option value="EXEC">Sales Executive</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></div>
      </div>
      <div class="fld"><label for="un">Full name</label><input id="un" [(ngModel)]="f.name" maxlength="100"></div>
      <div class="no-2col">
        <div class="fld"><label for="um">Mobile</label><input id="um" [(ngModel)]="f.mobile" inputmode="numeric" maxlength="10"></div>
        <div class="fld"><label for="uem">Email</label><input id="uem" type="email" [(ngModel)]="f.email" maxlength="150"></div>
      </div>
      <div class="no-2col">
        <div class="fld"><label for="ud">Designation</label><input id="ud" [(ngModel)]="f.designation" maxlength="80"></div>
        <div class="fld"><label for="ut">Territory</label><input id="ut" [(ngModel)]="f.territory" maxlength="80"></div>
      </div>
      <div class="fld"><label for="ug">Region</label><input id="ug" [(ngModel)]="f.region" maxlength="80"></div>
      <div class="fld"><label for="umg">Reports to</label><select id="umg" [(ngModel)]="f.managerId"><option [ngValue]="null">— none —</option>@for (m of managers(); track m.id) { <option [ngValue]="m.id">{{ m.name }} ({{ m.role }})</option> }</select></div>
      <label class="row mb12" style="font-size:13px;font-weight:700"><input type="checkbox" [(ngModel)]="f.isActive"> Active (inactive users cannot sign in)</label>
      @if (f.role === 'EXEC') {
        <div class="fld"><label>Assigned beats</label>
          <div class="wrap">@for (b of beats(); track b.id) { <button type="button" class="pillbtn" [class.on]="beatSel().has(b.id)" (click)="toggleBeat(b.id)">{{ b.code }} · {{ b.name }}</button> }</div></div>
      }
      <button class="btn primary" type="button" [disabled]="busy()" (click)="save()">Save user</button>
    </app-sheet>
    @if (camera()) { <app-selfie-camera [single]="true" heading="Profile Photo" (captured)="onCaptured($event)" (closed)="camera.set(false)" /> }`,
})
export class AdminUsersPage implements OnDestroy {
  private api = inject(Api);
  private ui = inject(Ui);
  private auth = inject(AuthService);
  users = signal<AdminUser[] | null>(null);
  beats = signal<AdminBeat[]>([]);
  err = signal<string | null>(null);
  open = signal(false);
  busy = signal(false);
  beatSel = signal(new Set<number>());
  photoUrl = signal<string | null>(null);
  photoUpdatedAt = signal<string | null>(null);
  photoBusy = signal(false);
  camera = signal(false);
  /** Photo chosen for a user that has not been created yet — uploaded right after the first save. */
  pendingPhoto: Blob | null = null;
  fmtDT = fmtDT;
  q = '';
  f = blank();
  managers = computed(() => (this.users() ?? []).filter(u => u.role !== 'EXEC' && u.isActive && u.id !== this.f.id));
  beatCodes = (ids: number[]) => ids.map(id => this.beats().find(b => b.id === id)?.code).filter(Boolean).join(', ') || '—';
  constructor() {
    this.load();
    this.api.get<AdminBeat[]>('/admin/beats').then(b => this.beats.set(b)).catch(() => {});
  }
  async load() {
    this.err.set(null);
    try { this.users.set(await this.api.get<AdminUser[]>('/admin/users', { search: this.q.trim() })); } catch (e) { this.err.set(errorMessage(e)); }
  }
  edit(u: AdminUser | null) {
    this.f = u ? { ...u, email: u.email ?? '' } : blank();
    this.beatSel.set(new Set(u?.beatIds ?? []));
    this.pendingPhoto = null;
    this.showPhoto(u?.id ?? null, u?.hasPhoto ?? false, u?.photoUpdatedAt ?? null);
    this.open.set(true);
  }
  ngOnDestroy() { this.setPhotoUrl(null); }
  private setPhotoUrl(url: string | null) { const old = this.photoUrl(); if (old) URL.revokeObjectURL(old); this.photoUrl.set(url); }
  /** Profile photos are not public files — fetched with the admin's token. */
  private async showPhoto(id: number | null, has: boolean, updatedAt: string | null) {
    this.setPhotoUrl(null);
    this.photoUpdatedAt.set(updatedAt);
    if (!id || !has) return;
    try {
      const b = await this.api.blob(`/admin/users/${id}/photo`);
      if (this.f.id === id) this.setPhotoUrl(URL.createObjectURL(b));
    } catch { /* shown as missing */ }
  }
  uploadPhoto(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { this.ui.error('Choose a JPG, PNG or WEBP photo'); return; }
    this.setPhoto(file);
  }
  onCaptured(c: SelfieCapture) {
    this.camera.set(false);
    URL.revokeObjectURL(c.preview);
    this.setPhoto(c.front);
  }
  /** Existing users: upload now. New users: preview locally and upload after the user is created. */
  private setPhoto(photo: Blob) {
    if (this.f.id) { this.sendPhoto(this.f.id, photo); return; }
    this.pendingPhoto = photo;
    this.setPhotoUrl(URL.createObjectURL(photo));
  }
  private photoForm(photo: Blob) {
    const fd = new FormData();
    fd.append('photo', photo, photo instanceof File ? photo.name : 'photo.jpg');
    return fd;
  }
  private async sendPhoto(id: number, photo: Blob) {
    this.photoBusy.set(true);
    try {
      const saved = await this.api.upload<AdminUser>(`/admin/users/${id}/photo`, this.photoForm(photo));
      await this.showPhoto(saved.id, saved.hasPhoto, saved.photoUpdatedAt);
      this.ui.success('✅ Profile photo saved');
      if (id === this.auth.user()?.id) this.auth.reloadProfile().catch(() => {});
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.photoBusy.set(false); }
  }
  toggleBeat(id: number) { const s = new Set(this.beatSel()); s.has(id) ? s.delete(id) : s.add(id); this.beatSel.set(s); }
  async save() {
    const f = this.f;
    if (!f.empCode.trim() || f.name.trim().length < 2 || !/^[6-9]\d{9}$/.test(f.mobile)) { this.ui.error('Emp code, name and a valid 10-digit mobile are required'); return; }
    const body = { empCode: f.empCode.trim(), name: f.name.trim(), mobile: f.mobile, email: f.email?.trim() || '', role: f.role,
      designation: f.designation?.trim() || undefined, region: f.region?.trim() || undefined, territory: f.territory?.trim() || undefined,
      managerId: f.managerId, isActive: f.isActive };
    this.busy.set(true);
    try {
      const saved = f.id ? await this.api.put<AdminUser>(`/admin/users/${f.id}`, body) : await this.api.post<AdminUser>('/admin/users', body);
      if (f.role === 'EXEC') await this.api.put(`/admin/users/${saved.id}/beats`, { beatIds: [...this.beatSel()] });
      if (!f.id && this.pendingPhoto) {
        const photo = this.pendingPhoto;
        this.pendingPhoto = null;
        try { await this.api.upload(`/admin/users/${saved.id}/photo`, this.photoForm(photo)); }
        catch (e) {
          // Keep the sheet open on the now-created user so a better photo can be added straight away.
          this.ui.error(`User saved, but the photo was rejected: ${errorMessage(e)}`);
          this.f = { ...saved, email: saved.email ?? '' };
          this.setPhotoUrl(null);
          await this.load();
          return;
        }
      }
      this.ui.success('✅ User saved');
      this.open.set(false);
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
