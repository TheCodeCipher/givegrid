# Contributing to GiveGrid

## Golden rule

`main` is the verified, stable version. Nobody develops on `main`.

## Roles

- **Tarun** — repository Owner/Admin and phase gate owner. Reviews, tests and promotes work to `main`.
- **Arkodyuti** — Write collaborator. Creates and pushes feature branches. Cannot push to `main`.

## Branches

Create every branch from the latest `main`:

```text
phase-<n>/<name>/<short-topic>      e.g.  phase-2/tarun/claim-transaction
```

- Small, focused commits with messages like `phase-2: implement transactional donation claims`.
- Push feature branches often. Do not force-push shared branches.
- Agree before two people edit the same migration or service file.

## Database changes

- Never edit a migration that has already been applied. Add a new numbered file in `database/migrations/`.
- Any new table needs explicit `GRANT`s for `givegrid_app` in the same migration.
- The app role must never receive `UPDATE`, `DELETE` or `TRUNCATE` on `donation_events`.

## Before asking for review

1. `cd backend && npm test` passes.
2. `cd frontend && npm run build` succeeds.
3. No `.env`, passwords or `node_modules` in the commit (`git status` is clean of them).
4. Move the GitHub issue to **Review — Tarun** with: summary, test command and output, known limitations.

## Promotion to main (Tarun)

Fetch the branch → read the diff → run the tests yourself → check the phase checklist →
merge into local `main` → rerun tests → push `main` → tag (`phase-1-complete`, ...).
A failed check sends the issue back to In Progress; nothing is merged.
