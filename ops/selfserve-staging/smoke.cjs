const assert = require('node:assert/strict');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const db = new PrismaClient();
async function request(provider, credentials) {
  const response = await fetch(
    `http://localhost:3000/public/v1/social/${provider}/credentials`,
    {
      method: 'POST',
      headers: {
        Authorization: process.env.STAGING_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ groupId: 'selfserve-staging-brand', credentials }),
    }
  );
  return { status: response.status, body: await response.json() };
}
(async () => {
  if (!process.env.DATABASE_URL.includes('/postiz_staging'))
    throw new Error('Staging only');
  const start = await db.integration.count();
  for (const [provider, credentials] of [
    [
      'bluesky',
      { identifier: 'invalid.bsky.social', password: 'wrong-password' },
    ],
    ['nostr', { privateKey: 'nsec1invalid' }],
    [
      'mastodon',
      { instanceUrl: 'http://127.0.0.1', accessToken: 'test-invalid' },
    ],
    [
      'lemmy',
      {
        service: 'http://127.0.0.1',
        identifier: 'invalid',
        password: 'test-invalid',
      },
    ],
    ['telegram', { botToken: 'invalid', chatId: '-1001234' }],
    ['discord', { webhookUrl: 'https://evil.example/api/webhooks/1/invalid' }],
    ['devto', { apiKey: '' }],
    ['hashnode', { personalAccessToken: 'invalid', publicationId: 'invalid' }],
  ]) {
    const result = await request(provider, credentials);
    assert.equal(
      result.status,
      400,
      `${provider}: expected a clear validation error`
    );
    assert(!JSON.stringify(result.body).includes('test-invalid'));
    console.log(`${provider}: invalid credentials rejected`);
  }
  assert.equal(
    await db.integration.count(),
    start,
    'Invalid credentials must not persist accounts'
  );
  const {
    generateSecretKey,
    nip19,
    getPublicKey,
  } = require('/app/node_modules/nostr-tools');
  const secret = generateSecretKey();
  const credentials = { privateKey: nip19.nsecEncode(secret) };
  const first = await request('nostr', credentials);
  assert.equal(first.status, 201);
  const repeated = await request('nostr', credentials);
  assert.equal(repeated.body.integration.id, first.body.integration.id);
  const row = await db.integration.findUnique({
    where: { id: first.body.integration.id },
  });
  assert(row.token.startsWith('secret:v1:'));
  assert(!row.token.includes(credentials.privateKey));
  assert.equal(row.customInstanceDetails, null);
  assert.equal(row.customerId, 'selfserve-staging-brand');
  console.log(
    'nostr: valid generated identity persisted encrypted; reconnect is idempotent'
  );
})()
  .finally(() => db.$disconnect())
  .catch(() => {
    console.error('Staging smoke check failed. No credentials were logged.');
    process.exitCode = 1;
  });
