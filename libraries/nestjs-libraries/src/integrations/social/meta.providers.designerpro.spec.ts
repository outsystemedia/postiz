import { FacebookProvider } from './facebook.provider';
import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';

describe('DesignerPRO Meta provider behavior', () => {
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
});
