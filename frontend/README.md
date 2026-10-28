# Marketing Management Application — frontend

Angular 22 single-page app (standalone components, signals, zoneless change detection).

```bash
npm install
npm start                      # http://localhost:4200, proxies /api and /uploads to http://localhost:3000
npx ng test --watch=false      # unit tests (Vitest)
npx ng build                   # production build → dist/frontend/browser
```

Structure: `src/app/core` (API client, auth, guards, models, formatting), `src/app/shared` (app bar, sheets,
beat insight list, QR scanner/generator, signature pad, calendar, route map), `src/app/features/*` (screens).

Setup, configuration, deployment and the role matrix are in the repository root `README.md`.
