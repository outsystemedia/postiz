#!/bin/sh
# DesignerPRO addition — not upstream Postiz code.
# The Prisma CLI is copied by trace-runtime.mjs, so startup does not need pnpm
# or the original workspace's full dependency tree.
set -eu

node /app/node_modules/prisma/build/index.js db push --accept-data-loss \
  --schema /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma

# A .cjs file here is an ecosystem declaration, not a JavaScript application.
# Passing `start <file>` makes PM2 launch the declaration itself as
# `runtime-processes:0`, leaving backend/frontend/orchestrator stopped. The
# runtime form without the `start` subcommand loads all apps from the file.
exec pm2-runtime /app/var/docker/runtime-processes.cjs
