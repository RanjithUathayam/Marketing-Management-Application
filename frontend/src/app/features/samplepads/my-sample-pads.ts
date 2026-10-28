import { Component } from '@angular/core';
import { AppBar } from '../../shared/ui.components';
import { SamplePadList } from './sample-pad-list';

@Component({
  selector: 'app-my-sample-pads',
  imports: [AppBar, SamplePadList],
  host: { class: 'sc' },
  template: `
    <app-bar title="Sample Pads" sub="Issued to you on delivery challans" fallback="/home" />
    <div class="body pad">
      <app-sample-pad-list />
      <div class="tiny center mt8">The same list is in Take Order → Sample Pad tab.</div>
    </div>`,
})
export class MySamplePadsPage {}
