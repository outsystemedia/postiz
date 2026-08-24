#!/bin/sh
# DesignerPRO addition — not upstream Postiz code.
# The Prisma CLI is copied by trace-runtime.mjs, so startup does not need pnpm
# or the original workspace's full dependency tree.
set -eu

node /app/node_modules/prisma/build/index.js db push --accept-data-loss \
  --schema /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma

# PM2 7 recognizes ecosystem declarations by the `.config.cjs` suffix.
exec pm2-runtime /app/var/docker/runtime-processes.config.cjs
