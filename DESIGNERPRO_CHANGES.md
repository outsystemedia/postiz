# DesignerPRO modifications to Postiz

This is a fork of [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app),
maintained by DesignerPRO, based on upstream tag **v2.21.10**. It is licensed
under the same **GNU Affero General Public License v3.0** as upstream — see
`LICENSE`, unmodified.

This file exists to satisfy AGPL-3.0's requirement (via GPLv3 §5, incorporated
by reference) to mark modified files and the dates of modification, and to
point users of the running service at this source, per AGPL-3.0 §13. DesignerPRO's
own application is a separate, private, proprietary codebase that talks to this
service exclusively over its HTTP API — no code from this repository is imported
into or linked with DesignerPRO's application.

## Why this fork exists

Postiz's official Public API (`/public/v1/*`) can list "groups" (its `Customer`
model, used to bucket social-channel integrations) but cannot create, rename,
delete one, or assign an integration to one — those operations exist only
behind Postiz's session-authenticated frontend. DesignerPRO needs real,
backend-enforced isolation of social channels per customer brand, so this fork
adds exactly those four missing operations to the Public API, reusing Postiz's
own existing internal logic wherever it already exists.

## Modified/added files

All changes below are also individually marked at the top of each file with a
`DesignerPRO addition — not upstream Postiz code` comment.

| File | Change | Date |
|---|---|---|
| `apps/backend/src/public-api/routes/v1/public.groups.controller.ts` | **New file.** Adds `POST /public/v1/groups` (create), `PUT /public/v1/groups/:id` (rename), `DELETE /public/v1/groups/:id` (soft-delete), `PUT /public/v1/integrations/:id/group` (assign) to the Public API. | 2026-07-15 |
| `apps/backend/src/public-api/routes/v1/public.groups.controller.spec.ts` | **New file.** Unit tests for the above. | 2026-07-15 |
| `apps/backend/src/public-api/public.api.module.ts` | **Modified.** One-line addition registering `PublicGroupsController` alongside the existing `PublicIntegrationsController`. | 2026-07-15 |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts` | **Modified.** Added `getCustomer`, `createCustomer`, `renameCustomer`, `deleteCustomer` methods. No existing methods changed. | 2026-07-15 |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.designerpro.spec.ts` | **New file.** Unit tests for the above. | 2026-07-15 |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts` | **Modified.** Added thin service-layer wrappers for the repository methods above. No existing methods changed. | 2026-07-15 |
| `docker-compose.designerpro.yaml` | **New file.** Staging/deployment compose file: builds the `postiz` and `temporal` images from this repo's source instead of pulling upstream's prebuilt images, uses `${VARIABLE}` placeholders for secrets instead of hardcoding them, drops the `temporal-ui`/`temporal` host port bindings and the `spotlight` debug service (not needed in this deployment). | 2026-07-15 |
| `var/docker/temporal.designerpro.Dockerfile` | **New file.** Small derived image that bakes Temporal's `dynamicconfig/development-sql.yaml` in at build time, since the deployment platform used didn't reliably materialize the upstream compose file's runtime bind-mount for it. | 2026-07-15 |
| `jest.config.designerpro.ts` | **New file.** Standalone Jest config scoped to the files above — the upstream root `jest.config.ts` depends on an Nx project graph (`nx.json`/`project.json`) that isn't present in this repository as published. | 2026-07-15 |
| `package.json` | **Modified.** Added a `test:designerpro-fork` script pointing at the config above. No existing scripts changed. | 2026-07-15 |
| `apps/frontend/src/app/source/route.ts` | **New file.** A `/source` route on the running service that redirects to this repository, per AGPL-3.0 §13. | 2026-07-16 |

## What is unchanged

Everything else in this repository is unmodified upstream Postiz source at
tag `v2.21.10`. In particular: no changes to the OAuth connection flow, to
Temporal workflow/activity code, to the Prisma schema, or to any existing
Public API endpoint's behavior.

## Getting the source

You are already looking at it. This repository's full history, including
every commit that makes up the above, is public. If you are interacting with
a deployment of this software over a network and were given a URL to a
private copy of it instead, ask the operator for a link to this repository.
