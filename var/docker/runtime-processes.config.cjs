// DesignerPRO addition — not upstream Postiz code.
// PM2 recognizes this filename as an ecosystem declaration.
module.exports = {
  apps: [
    {
      name: 'backend',
      script: './dist/apps/backend/src/main.js',
      cwd: '/app/apps/backend',
      interpreter: 'node',
      node_args: '--experimental-require-module'
    },
    {
      name: 'orchestrator',
      script: './dist/apps/orchestrator/src/main.js',
      cwd: '/app/apps/orchestrator',
      interpreter: 'node',
      node_args: '--experimental-require-module'
    },
    {
      name: 'frontend',
      script: '/app/apps/frontend/.next/standalone/apps/frontend/server.js',
      cwd: '/app/apps/frontend/.next/standalone/apps/frontend',
      interpreter: 'node',
      env: {
        PORT: '4200',
        HOSTNAME: '0.0.0.0'
      }
    }
  ]
}
