# HourMint Web

Responsive invoice and time-tracking web app for HourMint, backed by Supabase and ready for Netlify.

## What lives here

- `web/`: the React + TypeScript app
- `supabase/`: schema and migration SQL
- `netlify.toml`: Netlify build configuration
- `scripts/`: legacy data import helpers

## Web app features

- Email/password login backed by Supabase Auth
- Responsive dashboard for desktop and mobile
- Clients, projects, and time-entry management
- Invoice generation with summary, project, and detailed PDF variants
- Supabase Storage support for invoice PDFs and branding assets
- Settings for business name, invoice prefix, default detail level, and logo

## Environment

The web app expects:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

See `web/.env.example`.

## Local run

```bash
cd web
npm install
npm run dev
```

## Build

```bash
cd web
npm run build
```

## Legacy import

The local SQLite database and stored PDFs can be re-imported into a linked Supabase project with:

```bash
./scripts/import_legacy_to_supabase.sh
```
