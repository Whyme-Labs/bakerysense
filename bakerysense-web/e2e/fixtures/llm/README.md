# LLM fixtures for E2E

Playwright runs against `wrangler dev` with `BS_REPLAY_FIXTURES=1`. When a chat
request hits the LLMClient, it looks up a fixture by the first 16 hex chars of
SHA-256 over the canonical JSON of the request body, in R2 under
`fixtures/llm/<hash>.json`.

## First-time recording

1. Put real credentials in `bakerysense-web/.dev.vars` — at minimum
   `OPENROUTER_API_KEY`.
2. Run `npm run test:e2e:update-fixtures`. This sets both `BS_REPLAY_FIXTURES=1`
   AND `BS_RECORD_FIXTURES=1`. Missing fixtures fall through to the real
   connector and are written to R2 under the fixture prefix.
3. Pull the recorded JSON into this directory so it ships with the repo:
   ```
   wrangler r2 bucket object list bakerysense-models-dev --prefix fixtures/llm/
   wrangler r2 bucket object get bakerysense-models-dev/fixtures/llm/<hash>.json \
       > bakerysense-web/e2e/fixtures/llm/<hash>.json
   ```
4. Commit the JSON files.

## Re-recording after prompt changes

Any change to the system prompt or tool schemas (anything that feeds into the
request body) changes the request hash. Delete the old fixtures and re-record.
Fixture filenames are 16-hex-char hashes — stale fixtures show up as unmatched
files when `git status` is run after `npm run test:e2e` fails with a
`llm_replay: no fixture for hash ...` error.

## Uploading fixtures to R2 at test time

Task 4 (Playwright shared fixture) uploads these local JSON files to R2 at
test-setup via `env.MODELS.put`, so CI doesn't need persistent R2 state.
