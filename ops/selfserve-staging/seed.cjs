// Run only inside the isolated staging container, with STAGING_API_KEY injected.
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const db = new PrismaClient();
(async () => {
  if (
    !process.env.DATABASE_URL.includes('/postiz_staging') ||
    !process.env.STAGING_API_KEY
  )
    throw new Error('Staging database and API key required');
  await db.organization.upsert({
    where: { id: 'selfserve-staging-org' },
    create: {
      id: 'selfserve-staging-org',
      name: 'Self-serve staging',
      apiKey: process.env.STAGING_API_KEY,
    },
    update: { apiKey: process.env.STAGING_API_KEY },
  });
  await db.customer.upsert({
    where: { id: 'selfserve-staging-brand' },
    create: {
      id: 'selfserve-staging-brand',
      orgId: 'selfserve-staging-org',
      name: 'Self-serve staging brand',
    },
    update: {},
  });
  console.log('Isolated staging organization and brand ready.');
})().finally(() => db.$disconnect());
