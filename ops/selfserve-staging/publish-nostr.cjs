// Explicit publication smoke: run only with RUN_PUBLICATION_TEST=1.
// Publishes one test note under an ephemeral identity and prints only its URL.
const assert = require('node:assert/strict');
require('/app/node_modules/reflect-metadata');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const db = new PrismaClient();
(async () => {
  if (
    process.env.RUN_PUBLICATION_TEST !== '1' ||
    !process.env.DATABASE_URL.includes('/postiz_staging')
  )
    throw new Error('Explicit staging publication flag required');
  const row = await db.integration.findFirst({
    where: {
      organizationId: 'selfserve-staging-org',
      providerIdentifier: 'nostr',
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  assert(row);
  const {
    IntegrationManager,
  } = require('/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/integration.manager.js');
  const provider = new IntegrationManager().getSocialIntegration('nostr');
  const result = await provider.post(
    row.internalId,
    row.token,
    [
      {
        id: 'selfserve-staging-smoke',
        message:
          'Postiz self-serve staging connection test. Ephemeral test identity.',
        media: [],
        settings: { __type: 'nostr' },
      },
    ],
    row
  );
  assert(/^[a-f0-9]{64}$/.test(result[0].postId));
  console.log('Nostr relay acknowledgement received:', result[0].releaseURL);
})()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(
      'Nostr publication check failed:',
      error.message && !error.message.includes('nsec')
        ? error.message
        : 'safe error'
    );
    process.exitCode = 1;
  });
