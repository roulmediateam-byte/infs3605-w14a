# Security and data handling

## Report a problem

If you find a way to read another business's data, send a reminder without approval, or see a key or personal data in this repository, tell the Scrum Master and the Dev lead at once in the team chat (codes and links only, no data). Set the repository variable `JOBS_ENABLED` to `false` if scheduled jobs could make it worse. Record what happened and what was done in the decision log.

## Secrets

- Keys live only in GitHub Actions secrets, the hosting provider's settings or a local `.env` file that git ignores. Never in code, issues, pull requests or chat.
- The browser gets only Supabase's publishable key; row-level security and role checks do the rest.
- If a key may have leaked: create a new one, update the secret, revoke the old one, then check the provider's logs for use.

## Data

- Development and the demonstration use synthetic data labelled "Test data" (RI-9, NFR-02).
- Real business data is used only in owner testing, with the owner's written agreement, in the pilot project, with a `delete_after` date (D7, NFR-03).
- No personal data in AI requests, logs, error reports, GitHub or the team chat (NFR-04, PD-8).
- Each test business's data is deleted within 2 weeks of its testing, and all business data by Thu 31 Dec 2026 (NFR-03, PD-7). Deletion receipts record counts only.

## What protects the data

See [docs/security-model.md](docs/security-model.md): row-level security, table privileges, role checks in every write function, lifecycle triggers, an append-only activity log, and a CI check for keys and real-looking email addresses.
