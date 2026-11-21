# CLAUDE.md — Party Games (بازی‌های گروهی)

Read `docs/PLAN.md` before starting work. These rules are fixed for this repository.

## Stack (PLAN §3)

TypeScript strict · React 19 + Vite · Tailwind CSS v4 (tokens in `src/styles.css`) · shadcn-style components in `src/ui/kit.tsx` (cva + tailwind-merge) · Motion (`motion/react`, `LazyMotion` + `m`) · React Router `HashRouter` · Zustand · Zod · Trystero (behind the `Transport` interface) · vite-plugin-pwa · Vitest + Playwright · self-hosted Vazirmatn · pnpm · GitHub Actions → GitHub Pages.

## Non-negotiable rules

1. **Game logic is pure and tested.** `reduce(state, action, actor, ctx)` never mutates `state` and never touches the network, timers, `Date.now()` or `Math.random()`: use `ctx.now` and `ctx.rng` (seeded). Every reducer has Vitest tests (the test `Driver` deep-freezes state to prove purity).
2. **Secrets are never broadcast.** `broadcast()` is only for the public lobby. Game state leaves the host only through `viewFor(state, playerId)` sent with `toPeer()`. Add a test that the views of other players don't contain a new secret whenever you add one.
3. **Timers are absolute** (`endsAt`, host clock). The runner fires `$timeout` via `module.deadline()`.
4. **Roles are data**, not `if`s (PLAN §7). Custom roles/packs are validated with Zod and embedded in the game config.
5. **Text lives in `src/i18n/fa.ts`** (English mirror in `en.ts`). Reducers return `Msg` keys, never UI strings.
6. **RTL:** `<html dir="rtl" lang="fa">`; only logical Tailwind classes (`ms-/me-/ps-/pe-/start-/end-`), never `ml/mr/pl/pr/left/right` (ESLint enforces this). Numbers via `Intl.NumberFormat('fa-IR')`; room codes are Latin and `dir="ltr"`.
7. **Design:** mobile-first, dark default, one accent per family (`data-family`), buttons ≥ 48px, primary action at the bottom, animations < 300ms and `prefers-reduced-motion` respected.
8. Before building new UI, use the `ui-ux-pro-max` and `frontend-design` skills if installed (check `/skills`) and stay consistent with the existing design system.
9. New game modes = a folder under `src/games/<family>/` + an entry in `meta.ts` and `registry.ts`. Don't touch `src/core/` unless necessary, and explain why.

## Commands

- `pnpm dev` · `pnpm build` · `pnpm test` (unit) · `pnpm e2e` (Playwright, builds first) · `pnpm lint` · `pnpm typecheck`
- `ANALYZE=1 pnpm build` → `stats.html` bundle treemap
