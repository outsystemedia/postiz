# DesignerPRO addition — not upstream Postiz code.
#
# The official docker-compose.yaml bind-mounts ./dynamicconfig into the
# temporal container at runtime. Under Coolify's git-based dockercompose
# deployment, that bind-mount source directory ended up empty on the host
# even though the file is committed and present in the repo checkout used
# for building — Coolify appears not to materialize arbitrary bind-mount
# paths referenced only in `volumes:`, only what the build itself needs.
# Baking the file into the image at build time sidesteps that entirely and
# works regardless of the deployment platform.
FROM temporalio/auto-setup:1.28.1
COPY dynamicconfig/development-sql.yaml /etc/temporal/config/dynamicconfig/development-sql.yaml
