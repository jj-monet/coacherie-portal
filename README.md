# The Coacherie — Client Portal (Phase 0/1 scaffold)

This is a starting build against the plan doc (`coacherie-client-portal-plan.md`).
It covers what can be built without your actual Supabase project, Paperbell
account, or existing React codebase in front of me — the schema, the webhook
receiver that replaces Zapier, and portal/dashboard components ready to drop
into your existing app (or a new one) once wired to real credentials.

## What's here

```
supabase/migrations/0001_init.sql       Full schema + RLS policies
supabase/functions/paperbell-webhook/   Webhook receiver (replaces Zapier)
src/lib/supabase.ts                     Client-side Supabase client
src/pages/Login.tsx                     Magic-link login + purchase reconciliation
src/pages/Portal.tsx                    Client portal home
src/pages/CoachDashboard.tsx            Coach-facing dashboard (first pass)
src/styles/tokens.css                   Design tokens from design-system.md
```

## Setup

1. **Create/point at a Supabase project.** Run the migration:
   ```
   supabase db push
   ```
   or paste `supabase/migrations/0001_init.sql` into the SQL editor directly.

2. **Add yourself (your wife) as a coach.** After she signs up once via
   Supabase auth (any method — this table is separate from client auth):
   ```sql
   insert into coaches (id, email) values ('<her-auth-user-id>', 'her@email.com');
   ```

3. **Seed products.** One row per Threshold topic / Assessment / Journal, e.g.:
   ```sql
   insert into products (slug, title, type) values
     ('threshold-leaving-a-career', 'Leaving a Career You Built Your Identity Around', 'threshold_topic');
   ```
   Set `related_product_ids` once you know which topics should upsell each other.

4. **Deploy the webhook function:**
   ```
   supabase functions deploy paperbell-webhook
   ```
   Then point Paperbell's webhook config at the deployed URL. Two things to
   finish before this goes live:
   - Fill in `PAPERBELL_PRODUCT_SLUGS` in `index.ts` with real Paperbell product IDs.
   - Implement the signature/secret verification (marked TODO) — check
     Paperbell's webhook docs for what they provide.

5. **Env vars for the front end** (`.env`):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

6. **Drop the pages into your app's router.** These aren't a full app scaffold
   (no router, no build config) — they're built to slot into whatever React
   setup already hosts the Threshold Series prototype and Journal, since that's
   where the brand system and existing components already live.

## What's deliberately not built yet

- **Manual grant / "add a relationship" actions** on the coach dashboard —
  these need to bypass RLS the way the webhook function does, so they should
  be a small authenticated edge function, not a direct client-side write.
  Marked as a TODO in `CoachDashboard.tsx`.
- **Session-level progress UI** inside a Threshold topic (the `opened_at` /
  `completed_at` / low-friction gating logic from plan §9) — the schema
  supports it, the session-player component isn't built here since it
  depends on the existing Threshold Series prototype's structure.
- **Assessment retake confirmation UI** — the schema enforces "one row per
  client+assessment" (overwrite, no history), but the "this will replace
  your existing result" warning dialog itself isn't built yet.
- **Friendlier purchases/audit view** for customer service — raw Supabase
  table editor works fine for now (plan §3); a nicer view is a Phase 4+ nicety.

## Next step

Wire this against a real (or sandbox) Supabase project and confirm the schema
holds up once actual products and a test purchase flow are running through
it — that'll surface anything the plan missed faster than more up-front design.
