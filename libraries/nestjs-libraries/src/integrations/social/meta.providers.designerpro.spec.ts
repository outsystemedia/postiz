import { FacebookProvider } from './facebook.provider';
import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { ThreadsProvider } from './threads.provider';

describe('DesignerPRO Meta provider behavior', () => {
  const previousEnv = { ...process.env };

  afterAll(() => {
    process.env = previousEnv;
  });

  it('requests publishing and comment-management permissions in both OAuth entry points', () => {
    const required = [
      'pages_manage_posts',
      'pages_manage_engagement',
      'instagram_content_publish',
      'instagram_manage_comments',
    ];

    expect(new FacebookProvider().scopes).toEqual(
      expect.arrayContaining(required)
    );
    expect(new InstagramProvider().scopes).toEqual(
      expect.arrayContaining(required)
    );
    expect(new InstagramStandaloneProvider().scopes).toContain(
      'instagram_business_manage_comments'
    );
  });

  it('enforces exactly one attachment for an Instagram Story', async () => {
    const provider = new InstagramProvider();

    await expect(
      provider.checkValidity(
        [
          [
            { path: 'https://cdn.example.com/one.jpg' },
            { path: 'https://cdn.example.com/two.jpg' },
          ],
        ],
        { post_type: 'story' }
      )
    ).resolves.toContain('exactly one media attachment');
    await expect(
      provider.checkValidity([[{ path: 'https://cdn.example.com/one.jpg' }]], {
        post_type: 'story',
      })
    ).resolves.toBe(true);
  });

  it('applies Story cardinality and rejects unsupported audio in standalone mode', async () => {
    const provider = new InstagramStandaloneProvider();
    const twoImages = [
      { path: 'https://cdn.example.com/one.jpg' },
      { path: 'https://cdn.example.com/two.jpg' },
    ];

    await expect(
      provider.checkValidity([twoImages], { post_type: 'story' })
    ).resolves.toContain('exactly one media attachment');
    await expect(
      provider.checkValidity([[{ path: 'https://cdn.example.com/reel.mp4' }]], {
        post_type: 'post',
        audio: { id: 'unsupported' },
      })
    ).resolves.toContain('only supported');
  });

  it('offers Facebook login on the direct Instagram authorization screen', async () => {
    process.env.FRONTEND_URL = 'https://postiz.example.com';
    process.env.INSTAGRAM_APP_ID = 'instagram-app';
    process.env.INSTAGRAM_APP_SECRET = 'instagram-secret';

    const auth = await new InstagramStandaloneProvider().generateAuthUrl();
    const url = new URL(auth.url);

    expect(url.searchParams.get('enable_fb_login')).toBe('1');
    expect(url.searchParams.get('client_id')).toBe('instagram-app');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://postiz.example.com/integrations/social/instagram-standalone'
    );
    expect(auth.state).toHaveLength(32);
  });

  it('validates Threads media and forwards its publishing controls', async () => {
    process.env.FRONTEND_URL = 'https://postiz.example.com';
    process.env.THREADS_APP_ID = 'threads-app';
    process.env.THREADS_APP_SECRET = 'threads-secret';
    const provider = new ThreadsProvider();
    const auth = await provider.generateAuthUrl();

    expect(new URL(auth.url).searchParams.get('client_id')).toBe('threads-app');
    expect(provider.scopes).toEqual(
      expect.arrayContaining(['threads_basic', 'threads_content_publish'])
    );
    expect(
      (provider as any).publicationOptions({
        reply_control: 'followers_only',
        topic_tag: '#Design',
      })
    ).toEqual({ reply_control: 'followers_only', topic_tag: 'Design' });
    await expect(
      provider.checkValidity([
        Array.from({ length: 21 }, (_, index) => ({
          path: `https://cdn.example.com/${index}.jpg`,
        })),
      ])
    ).resolves.toContain('at most 20');
  });
});
