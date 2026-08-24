#!/bin/sh
# DesignerPRO addition — not upstream Postiz code.
# The Prisma CLI is copied by trace-runtime.mjs, so startup does not need pnpm
# or the original workspace's full dependency tree.
set -eu

node /app/node_modules/prisma/build/index.js db push --accept-data-loss \
  --schema /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma

exec pm2-runtime start /app/var/docker/runtime-processes.cjs
