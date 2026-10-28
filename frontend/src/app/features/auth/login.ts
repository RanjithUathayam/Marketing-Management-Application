import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { AttendanceToday } from '../../core/models';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  host: { class: 'sc' },
  template: `
    <header class="bar grad" style="padding-top:44px;justify-content:center"><div class="btitle" style="text-align:center;flex:none">Marketing Management Application</div></header>
    <div class="body" style="display:flex;flex-direction:column">
      <form class="pad" style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px" (ngSubmit)="submit()">
        <div class="center" style="margin-bottom:6px">
          <div style="width:74px;height:74px;border-radius:22px;background:linear-gradient(135deg,#0d6e50,#10a070);display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 14px;box-shadow:0 8px 24px rgba(13,110,80,.3)" aria-hidden="true">🧭</div>
          <h1 style="font-size:20px;font-weight:800">Welcome back</h1>
          <div class="muted">Sales executive, manager &amp; admin login</div>
        </div>
        <div class="card p">
          <div class="fld">
            <label for="mobile">Mobile Number</label>
            <input id="mobile" name="mobile" [(ngModel)]="mobile" inputmode="numeric" maxlength="10" autocomplete="tel-national"
                   placeholder="10-digit mobile" [readonly]="otpSent()" [class.err]="!!mobileErr()" (input)="mobileErr.set('')">
            @if (mobileErr()) { <div class="ferr">{{ mobileErr() }}</div> }
          </div>
          @if (otpSent()) {
            <div class="fld">
              <label for="otp">Enter OTP <span class="tiny">(sent via SMS &amp; WhatsApp)</span></label>
              <input id="otp" name="otp" [(ngModel)]="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit OTP">
              @if (devOtp()) { <div class="fhint ok">Development mode — OTP {{ devOtp() }} has been filled in.</div> }
            </div>
          }
          <button class="btn primary" type="submit" [disabled]="busy()">
            @if (busy()) { <span class="spin sm"></span> } {{ otpSent() ? 'Verify & Continue' : 'Send OTP' }}
          </button>
          @if (otpSent()) {
            <div class="between mt12">
              <button class="pillbtn" type="button" (click)="changeNumber()">Change number</button>
              <button class="pillbtn" type="button" [disabled]="busy()" (click)="send()">Resend OTP</button>
            </div>
          }
          <div class="tiny center mt12">🔒 OTP delivered on SMS + WhatsApp</div>
        </div>
        <div class="tiny center">Need help? Call support on 1800-000-123</div>
      </form>
    </div>`,
})
export class LoginPage {
  private auth = inject(AuthService);
  private api = inject(Api);
  private router = inject(Router);
  private ui = inject(Ui);
  mobile = '';
  otp = '';
  otpSent = signal(false);
  busy = signal(false);
  devOtp = signal<string | null>(null);
  mobileErr = signal('');

  submit() { this.otpSent() ? this.verify() : this.send(); }

  async send() {
    this.mobile = this.mobile.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(this.mobile)) { this.mobileErr.set('Enter a valid 10-digit mobile number'); return; }
    this.busy.set(true);
    try {
      const r = await this.auth.requestOtp(this.mobile);
      this.otpSent.set(true);
      this.devOtp.set(r.devOtp ?? null);
      if (r.devOtp) this.otp = r.devOtp;
      this.ui.toast('📩 OTP sent via SMS + WhatsApp');
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }

  async verify() {
    if (!/^\d{6}$/.test(this.otp)) { this.ui.error('Enter the 6-digit OTP'); return; }
    this.busy.set(true);
    try {
      const user = await this.auth.verifyOtp(this.mobile, this.otp);
      if (user.role === 'EXEC') {
        const t = await this.api.get<AttendanceToday>('/attendance/today');
        this.router.navigateByUrl(t.dayStarted ? '/home' : '/start-day');
      } else this.router.navigateByUrl('/manager');
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }

  changeNumber() { this.otpSent.set(false); this.otp = ''; this.devOtp.set(null); }
}
