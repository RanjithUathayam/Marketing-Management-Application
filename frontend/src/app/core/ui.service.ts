import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions { title: string; message?: string; confirmText?: string; cancelText?: string; danger?: boolean }

/** App-wide toast and confirm dialog state, rendered once by the shell. */
@Injectable({ providedIn: 'root' })
export class Ui {
  readonly toastMsg = signal<{ text: string; kind: 'info' | 'error' | 'success' } | null>(null);
  readonly confirmState = signal<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  toast(text: string, kind: 'info' | 'error' | 'success' = 'info') {
    clearTimeout(this.timer);
    this.toastMsg.set({ text, kind });
    this.timer = setTimeout(() => this.toastMsg.set(null), kind === 'error' ? 3600 : 2400);
  }
  error(text: string) { this.toast(text, 'error'); }
  success(text: string) { this.toast(text, 'success'); }

  confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise(resolve => this.confirmState.set({ ...opts, resolve }));
  }
  closeConfirm(ok: boolean) {
    const s = this.confirmState();
    this.confirmState.set(null);
    s?.resolve(ok);
  }
}
