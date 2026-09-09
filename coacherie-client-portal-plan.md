# The Coacherie — Client Portal (LMS) Plan

**Status:** Planning draft — no build started
**Author:** JJ
**Last updated:** 2026-08-14

---

## 1. Purpose

A single logged-in home for a client that:

- Shows only the products she's purchased (Threshold Series topics, Assessment, Journal, any future product)
- Bookmarks her place inside a course and lets her pick up where she left off
- Stores her work — journal entries, reflection responses, exercise answers, assessment results — permanently, tied to her identity, not the device she used
- Feels like one coherent "Coacherie" experience rather than four separate tools bolted together
- Works identically whether the client is a random one-off buyer or an existing 1:1 coaching client, without being two different systems

This is **not** meant to become a general-purpose LMS product. It's purpose-built for The Coacherie's specific catalog (text/reflection-based, no video, no quizzes/certificates, no cohorts).

---

## 2. Guiding principles (carried over from prior decisions)

- **No third-party course platform.** Thinkific/Teachable/Kajabi/Podia/Teachery have all been evaluated and rejected — the products don't need video/quiz/certificate infrastructure, and a platform would fragment purchases/progress/brand from the rest of the suite.
- **Build on the existing stack:** React front end, Supabase for auth + data, GitHub Pages for hosting, Paperbell for checkout.
- **One identity, one record.** A client's purchases, progress, and reflections should all resolve to the same Supabase user row, regardless of which product she's using.
- **Magic-link auth, not email-only lookup** — email-only lookup would let anyone who knows/guesses a client's email see her private reflections.
- **Reuse, don't rebuild.** The Journal's tag system and the Threshold Series entitlement/progress stubs are the seeds of this system, not throwaway prototypes.
- **All information sharing with the coach is voluntary, never a condition of participation.** Nothing about a client's progress or written content is visible to the coach unless the client actively opts in, regardless of whether she's a one-off buyer or an existing coaching client.

---

## 3. Infrastructure decisions (re-examined, not assumed)

Revisited each piece of the stack rather than treating it as a given:

| Layer | Decision | Reasoning |
|---|---|---|
| Database + auth | **Keep Supabase (managed).** | Not real vendor lock-in — it's open Postgres with RLS, portable via `pg_dump` if ever needed. Free tier ($0) is far beyond what this scale needs: 500MB storage, 50K MAUs, encrypted at rest (AES-256) and in transit (TLS), SOC 2 Type 2 / ISO 27001 / GDPR compliant. **One gap to close:** no automatic backups on the free tier — either upgrade to Pro (~$25/mo, adds point-in-time recovery) once live, or set up a scheduled manual export, given the sensitivity of journal content. |
| Purchase → DB bridge | **Replace Zapier with a self-owned webhook receiver** (Supabase Edge Function or similar). | Zapier was only ever a workaround for GitHub Pages having no server to receive Paperbell's webhook. A small function removes a recurring subscription and a point of silent failure, and gives a real audit log of every incoming purchase event — including failed ones, which Zapier currently obscures. |
| Purchase data access | **Confirmed sufficient as-is.** | Supabase's table editor and SQL editor give direct, on-demand access to the purchases table for customer service, bookkeeping, and audits — CSV export included. No separate reporting tool needed. |
| Hosting | **Keep GitHub Pages.** | No reason to change; fine for a static React front end. |

---

## 4. Inventory — what already exists

| Piece | Status |
|---|---|
| `purchases` table in Supabase | Currently fed by Paperbell → Zapier; to be re-pointed at a self-owned webhook receiver (§3) |
| Magic-link login flow | Designed for Threshold Series, not yet built |
| Guided Reflection Journal | React prototype complete, tag-based/weighted rotation, currently fully client-side (no persistence to an account) |
| Discover Yourself Assessment | Moving to deterministic, template-driven output |
| Threshold Series module prototype | One full module built ("Leaving a Career..."), 5-session arc, entitlement/progress **stubbed** for later Supabase wiring |
| Brand system | `design-system.md` — typography, palette, voice, already governs all client-facing surfaces |
| Hosting | GitHub Pages for tools; `products.html` is the on-demand tools grid |

**The gap this plan fills:** none of these currently share a login or a persistence layer. The Journal doesn't know who the client is. The Assessment output isn't stored against an account. Threshold Series progress has nowhere real to write to yet. The portal is the layer that unifies them.

---

## 5. Core data model (Supabase)

Proposed tables — names indicative, not final:

**`clients`**
- `id` (uuid, = Supabase auth user id), `email`, `display_name` (optional), `created_at`

**`products`**
- `id`, `slug`, `title`, `type` (`threshold_topic` | `assessment` | `journal` | future types), `description`

**`coaching_relationships`**
- `id`, `client_id`, `client_email`, `started_at`, `active` (bool), `notes` (coach-facing, not client-visible)
- Created manually by the coach (comps, new coaching engagements) — see §7 for how purchases get matched to an existing one
- Existence of a relationship record tells the coach *who her clients are* — it does **not** by itself grant her visibility into anything they do (see §8)

**`purchases`** *(already exists — extend as needed)*
- `id`, `client_email`, `product_id`, `purchased_at`, `source`, `webhook_event_id`

**`entitlements`**
- `id`, `client_id`, `product_id`, `coaching_relationship_id` (nullable — see §7 for how this gets set), `granted_at`, `source` (`purchase` | `manual_grant`)
- Resolves "does this client currently have access to this product" — a single write here handles refunds/revocations rather than a cascade through purchases
- **Important:** `coaching_relationship_id` being set means only "this access was granted through/alongside a coaching engagement." It is a record-keeping fact, not a visibility grant.

**`progress`**
- `client_id`, `product_id`, `unit_id`, `status`, `last_position`, `updated_at`
- `visible_to_coach` (bool, default **false**) — client-controlled, independent of whether a `coaching_relationship_id` exists on the entitlement

**`journal_entries`**
- `client_id`, `entry_text`, `tags[]`, `source_product_id` (nullable), `created_at`
- `shared_with_coach` (bool, default **false**) — per-entry, client-controlled

**`exercise_responses`**
- `client_id`, `product_id`, `unit_id`, `prompt_id`, `response_text`, `created_at`, `updated_at`
- `shared_with_coach` (bool, default **false**)

**`assessment_results`**
- `client_id`, `assessment_id`, `responses` (jsonb), `computed_output` (jsonb), `created_at`

This keeps journaling, exercises, and assessment results as **distinct record types** while all resolving to one `client_id`. RLS scopes every table so a client can only ever read/write her own rows; coach access to any `visible_to_coach`/`shared_with_coach` = true rows would be a narrowly-scoped separate policy, added only once §8 is confirmed with your wife.

---

## 6. Auth & entitlement flow

1. Client lands on a product page and enters her email.
2. Supabase sends a magic link to that address.
3. On click, Supabase resolves/creates her `clients` row and issues a session.
4. Portal queries `entitlements` for that `client_id`.
5. Portal renders only entitled products; everything else appears locked/purchasable with a link to the relevant Paperbell checkout.

**Email-matching edge case:** purchases key strictly on email at checkout time, with a manual "wrong email? contact us" reconciliation path for the rare mismatch. This mirrors how course platforms handle it at any scale, including much larger ones — login tied to purchase email, mismatches resolved as an occasional manual support fix rather than an automated merge/claim system. Confirmed as the approach.

**Client-facing rule, must be stated plainly on the login screen:** you must log in with the same email you purchased with. This is the single most important thing for a client to know about the login flow, since it's also what silently resolves the mismatch edge case above — most support requests this generates are preventable just by saying it clearly up front.

---

## 7. Categorizing a purchase: standalone vs. coaching-linked

The default assumption is that a purchase is a standalone, one-off transaction — no visibility, no relationship record, nothing for the coach to see. Two paths determine when a purchase instead gets tied to an existing coaching relationship:

1. **Purchase email matches an existing `coaching_relationships` record** → auto-linked, no review step. The purchase email is treated as sufficient proof of the match — no confirmation queue needed. (Note: Paperbell doesn't support true single-use or client-specific promo codes, so a discount code can't reliably serve as the identifying signal here — email match is the mechanism.)
2. **Manual grant, no checkout at all** → she creates the entitlement directly, already carrying the `coaching_relationship_id`. No pipeline involvement.
3. **Everything else** (email matches nothing on file) → standalone, no flag, no dashboard entry beyond the ordinary purchase record. This is the guardrail that keeps her coaching-relationship view from ever showing every random one-off buyer.

She can still generate ordinary (non-unique) Paperbell discount codes for pricing purposes — a comp or add-on discount — that's independent of this categorization logic, which runs on email alone.

---

## 8. Coach visibility — always opt-in, never automatic

Regardless of how an entitlement was categorized in §7, **nothing about a client's usage is visible to the coach by default.** This applies equally to one-off buyers and existing coaching clients — a `coaching_relationship_id` on an entitlement affects only how the *purchase* is categorized, never whether progress or content is shared.

- **Progress visibility** (`progress.visible_to_coach`): a client-facing toggle, e.g. "share my progress on this with [coach]." Off by default, for everyone, always.
- **Content visibility** (`journal_entries.shared_with_coach`, `exercise_responses.shared_with_coach`): a per-entry share action, not a blanket setting. Off by default.

**The one unavoidable exception:** the coach necessarily knows an entitlement exists for anyone in her `coaching_relationships` table — that's a minimum she can't not know. Everything beyond bare existence — any usage, any content — is the client's choice, every time, with no difference in what participation requires.

---

## 9. Progress & bookmarking

- Each Threshold topic is 5 sessions (Naming the Threshold → What You're Leaving → The In-Between → What's Emerging → Crossing). Progress is tracked per session, plus a `last_position` for resuming mid-session.
- "Resume where you left off" on the portal home = most recent `in_progress` unit across all entitled products.
- **Decided — gating:** sequential, but low-friction. Reaching the end of a session (paging through it) unlocks the next one; the client is not required to complete the session's reflection prompts or exercises to advance. This needs two separate progress signals per session: `opened`/`viewed-through` (gates the next session) and `marked_complete` (explicit action, tracked separately, does not gate anything).
- **Decided — completion:** an explicit "mark complete" action exists and is tracked, but per the above it's decoupled from unlocking — a client can move ahead having viewed but not completed a session's activities.

---

## 10. Records: journaling, exercises, assessments

- Journal entries originating from a Threshold reflection prompt save into the same `journal_entries` table the standalone Journal uses, tagged with both the Journal's tag system and `source_product_id`, so they appear in "my journal" and "my Threshold Series work" without duplicating storage.
- Exercise responses (structured, non-journal answers) get their own table so they can be rendered back into the course UI without polluting the Journal's rotation logic.
- **Decided:** retakes are allowed. Retaking overwrites the previous result (no history kept) — the retake flow must warn the client clearly before submitting that this will replace her existing result, since there's no undo once it saves.

---

## 11. Website integration

Recommend a **subdomain** (e.g. `portal.thecoacherie.com`) — cleanest separation, own deploy pipeline, still matches brand, and fits the existing GitHub Pages pattern. A path on the main site adds unnecessary coupling; an embedded iframe adds auth complications for no real benefit here.

---

## 12. Client-facing UX (first pass)

**Portal home:** "Continue" surfaced first, grid of entitled products with progress shown. **Decided:** locked/unpurchased products are shown as upsells, but only when genuinely related to something the client already owns — e.g. surfacing another Threshold topic after she's engaged with one, not the full unpurchased catalog. Needs a `related_product_ids` (or similar) field on `products` so relatedness is curated, not inferred.

**Inside a Threshold topic:** session navigator (1–5), reflection prompts saving to Journal in the background, journal accessible without leaving the course, per-topic "share my progress" toggle (§8).

**Journal (standalone):** same as current prototype, now reading/writing against the client's account.

**Assessment:** take/retake entry point, most recent result displayed.

---

## 13. Coach-facing needs

**Decided:** she wants a dashboard. First-pass scope (to refine with her, not final):

- **Client list** — everyone in `coaching_relationships`, active/inactive, with the entitlements tied to each
- **Per-client shared view** — whatever progress or journal/exercise content that specific client has opted to share, clearly marked as client-initiated sharing, not a default
- **Add a relationship / manual grant** — the UI for creating a `coaching_relationships` row and/or granting an entitlement directly, without a Paperbell purchase
- **All purchases view** — a friendlier read of the `purchases`/`entitlements` tables than the raw Supabase table editor, for quick customer-service lookups
- **Basic activity signal** — last-shared-update timestamp per client, so she can see who's actively engaging without needing content detail

This is a starting shape, not a spec — refine with her once she sees it in use.

---

## 14. Build phases (proposed)

**Phase 0 — Foundations**
- Supabase schema (§5) + RLS policies, including the opt-in visibility fields
- Self-owned webhook receiver replacing Zapier
- Magic-link auth wired end-to-end

**Phase 1 — Portal shell**
- Portal home, entitled/locked products, "continue" surfacing
- Deployed to subdomain

**Phase 2 — Threshold Series integration**
- Wire the existing module prototype's stubbed entitlement/progress calls to real Supabase tables
- Session-level progress + bookmarking
- Reflection prompts writing to `journal_entries`

**Phase 3 — Journal & Assessment integration**
- Journal reads/writes against `client_id`
- Assessment results persisted, retake behavior decided and built

**Phase 4 — Coaching-relationship layer**
- `coaching_relationships` table
- Purchase categorization logic (§7) in the webhook receiver (email-match auto-linking)
- Client-facing share toggles for progress and content (§8)
- Coach dashboard (§13)

---

## 15. Open decisions needed before/during build

1. Assessment retake behavior (history vs. latest-only)
2. Whether the portal shows locked/unpurchased products as upsell surfaces
3. Coach dashboard layout/detail (§13) — scope agreed, specifics not yet designed

---

*Next step once this plan is confirmed: finalize the Supabase schema (§5) and RLS policies, since everything else builds on top of that.*
