# Self-serve channels — staging only

This stack is isolated from production: separate Docker network, PostgreSQL,
Redis, Temporal/Elasticsearch, credentials and volumes; localhost-only ports.
Never apply this compose file to the production Coolify project.

## Current review environment

VPS: `root@100.115.167.3`, directory `/opt/postiz-selfserve-staging`.

- Postiz API directly: `http://127.0.0.1:3017/public/v1` on the VPS.
- Postiz through nginx: `http://127.0.0.1:4017/api/public/v1`.
- API key: `STAGING_API_KEY` in the staging `.env` (mode 0600). Never print it.
- Test org: `selfserve-staging-org`; test group: `selfserve-staging-brand`.

To access from a developer machine:

```sh
ssh -N -L 4017:127.0.0.1:4017 root@100.115.167.3
```

The image is a staging-only runtime patch over the exact inspected production
base commit `d48e9556`. `build-runtime-patch.cjs` compiles changed runtime files
into `patch/`, which the staging Dockerfile copies to backend and orchestrator.
A future production release must use the normal complete repository build,
after separate user approval. No schema migration was introduced.

## Run checks on staging

```sh
cd /opt/postiz-selfserve-staging
set -a
. ./.env
set +a
docker compose exec -T -e STAGING_API_KEY postiz node < seed.cjs
docker compose exec -T -e STAGING_API_KEY postiz node --experimental-require-module < smoke.cjs
docker compose exec -T -e STAGING_API_KEY postiz node < live-invalid.cjs
```

The smoke script uses an ephemeral Nostr key, verifies encryption, checks
idempotent reconnect, and never publishes anything. `live-invalid.cjs` performs
only intentionally invalid authentication requests against remote services.
Neither script prints submitted credentials.

## Per-channel manual acceptance

Connect from DesignerPRO `/brands/<test-brand>/social` with owner/admin access.
Only a test DesignerPRO instance with Firebase emulators/test data must point
to this Postiz API. Set server-only `POSTIZ_BASE_URL=http://127.0.0.1:4017` and
`POSTIZ_API_KEY` to the staging key using a private local env file. Do not change
production environment variables. The browser never receives the Postiz key.

| Channel | Connection | Publication test |
| --- | --- | --- |
| Bluesky | Service URL, identifier, App Password (`xxxx-xxxx-xxxx-xxxx`). Never main password. | Text or existing image/video flow; verify returned post URL. |
| Nostr | `nsec` plus optional comma-separated public WSS relays. | Signed kind-1 note; at least one relay must acknowledge the exact event ID. |
| Mastodon | HTTPS instance URL and access token with read:accounts, write:statuses, write:media. | Text/image on that instance. |
| Lemmy | HTTPS API-v3 instance, username/email, password. Instances requiring extra authentication need a supported login method. | Select the channel in composer, enter title and numeric community ID. |
| Telegram | BotFather token and destination ID. Add bot as administrator with posting rights for channels. | Text or media in a private test destination. |
| Discord | Incoming webhook URL OR bot token plus channel ID. Create/invite bot through Developer Portal. | Text/media in the fixed test destination; allow Attach Files for media. Follow-ups are separate messages. |
| Dev.to | API key from Settings → Extensions. | Article title and up to four optional tag names. |
| Hashnode | PAT plus Publication ID; owner or verified editor access. | Title (6+ characters), 1–15 tag slugs. Current API requires a Pro publication. |

For each channel, first try invalid credentials and verify a specific error,
then valid credentials, refresh the page, and verify the persisted connection.
Reconnect the same account in the same brand and check its integration ID is
unchanged. Connect from another test brand and verify the first connection
remains intact. Existing legacy integrations use their unchanged credentials
and publishing paths; new records are scoped to provider + group + identity.

Hashnode's free API was retired on 2026-05-13. `gql.hashnode.com` now redirects
to the announcement. New connections use `gql-beta.hashnode.com`; the UI and
backend explicitly explain Pro restrictions. No plan is purchased by this code.

Sources: https://hashnode.com/changelog/2026-05-13-graphql-api-paid-access and
https://github.com/Hashnode/gql-skill/tree/main/skills/gql-api/references.

## Results recorded on 2026-09-08

- Postiz regression suite: 57 tests passed; backend build TypeScript check passed.
- DesignerPRO connection/publication suites: 97 tests passed. Real components
  passed browser checks for all eight forms, Discord mode switching, invalid
  credentials, retry, and clearing secrets after a successful mocked connection.
- Full DesignerPRO `svelte-check`: 257 existing errors / 14 warnings in 74 files;
  no diagnostics in the files changed by this implementation.
- Staging HTTP API: malformed input rejected for all eight providers; generated
  Nostr identity persisted as `secret:v1:` and reconnect reused the same row.
- Real external invalid authentication: seven remote providers returned handled
  HTTP 400 errors. No test credential markers appeared in Postiz container logs.
- One real Nostr note was acknowledged by a relay, using the registered provider
  and the encrypted staging connection. This exercised the provider directly,
  not the DesignerPRO/Firebase/Temporal scheduling path.

Published note:
https://primal.net/e/2977d5233a05e8fa9c67b20a36d975c7de2b26a58f34653e567cdfc9eda6d823

To explicitly publish another public Nostr smoke note with the test identity:

```sh
docker compose exec -T -e RUN_PUBLICATION_TEST=1 postiz node --experimental-require-module < publish-nostr.cjs
```

## Remaining external acceptance

Real Bluesky/Mastodon/Lemmy, Telegram/Discord and Dev.to/Hashnode publication
checks need user-owned test credentials. Do not substitute production accounts.
A successful mocked test or Nostr key validation is not proof that these real
publications succeeded. Record the published URLs only after confirming them.
