import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
@Component({selector: 'app-root', template: '<main><h1>Angular recipe</h1><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="32" height="32" /></main>'})
class App {}
bootstrapApplication(App, {providers: [provideZonelessChangeDetection()]}).catch(console.error);
