// Read-only remote authentication attempts using intentionally invalid tokens.
(async () => {
  const cases = [
    [
      'bluesky',
      {
        identifier: 'invalid-selfserve-test.bsky.social',
        password: 'aaaa-bbbb-cccc-dddd',
      },
    ],
    [
      'mastodon',
      {
        instanceUrl: 'https://mastodon.social',
        accessToken: 'invalid-selfserve-test',
      },
    ],
    [
      'lemmy',
      {
        service: 'https://lemmy.world',
        identifier: 'invalid-selfserve-test',
        password: 'invalid-selfserve-test',
      },
    ],
    [
      'telegram',
      {
        botToken: '123456789:invalid_selfserve_test_token_123456',
        chatId: '-100123456789',
      },
    ],
    [
      'discord',
      { botToken: 'invalid-selfserve-test', channelId: '123456789123456789' },
    ],
    ['devto', { apiKey: 'invalid-selfserve-test' }],
    [
      'hashnode',
      {
        personalAccessToken: 'invalid-selfserve-test',
        publicationId: '000000000000000000000000',
      },
    ],
  ];
  for (const [provider, credentials] of cases) {
    const response = await fetch(
      `http://localhost:3000/public/v1/social/${provider}/credentials`,
      {
        method: 'POST',
        headers: {
          Authorization: process.env.STAGING_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          groupId: 'selfserve-staging-brand',
          credentials,
        }),
        signal: AbortSignal.timeout(95000),
      }
    );
    const body = await response.json();
    if (
      response.ok ||
      !body.msg ||
      JSON.stringify(body).includes('invalid-selfserve-test')
    )
      throw new Error(
        `${provider}: invalid credentials were not safely rejected`
      );
    console.log(
      `${provider}: rejected with HTTP ${response.status}; friendly error returned`
    );
  }
})().catch((error) => {
  console.error('Live-invalid check failed:', error.name);
  process.exitCode = 1;
});
