// DesignerPRO additions — inline WordPress article media regression tests.
import 'reflect-metadata';
import dns from 'node:dns/promises';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { WordpressProvider } from './wordpress.provider';

describe('WordpressProvider — DesignerPRO security additions', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-with-enough-entropy';
    jest.restoreAllMocks();
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  it('rejects a private WordPress target before making a request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const provider = new WordpressProvider();
    const code = Buffer.from(
      JSON.stringify({
        domain: 'https://127.0.0.1',
        username: 'editor',
        password: 'application-password',
      })
    ).toString('base64');

    await expect(
      provider.authenticate({ code, codeVerifier: 'none' })
    ).resolves.toBe('Invalid credentials');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes the domain and encrypts credentials before persistence', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 7,
        name: 'Editor',
        avatar_urls: { '96': 'https://wp.example.com/avatar.jpg' },
      }),
    });
    global.fetch = fetchMock as any;
    const provider = new WordpressProvider();
    const code = Buffer.from(
      JSON.stringify({
        domain: 'https://wp.example.com/blog/',
        username: ' editor ',
        password: ' application-password ',
      })
    ).toString('base64');

    const result = await provider.authenticate({ code, codeVerifier: 'none' });

    expect(typeof result).not.toBe('string');
    const details = result as Exclude<typeof result, string>;
    expect(details.id).toBe('https://wp.example.com/blog_7');
    expect(details.accessToken).toMatch(/^secret:v1:/);
    expect(details.accessToken).not.toContain('application-password');
    const decoded = JSON.parse(
      Buffer.from(
        AuthService.decryptSecret(details.accessToken),
        'base64'
      ).toString()
    );
    expect(decoded).toEqual({
      domain: 'https://wp.example.com/blog',
      username: 'editor',
      password: 'application-password',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wp.example.com/blog/wp-json/wp/v2/users/me',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
        dispatcher: expect.anything(),
      })
    );
  });

  it('decrypts the stored token and uses the anti-SSRF dispatcher for tools', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        post: { name: 'Posts', rest_base: 'posts' },
        page: { name: 'Pages', rest_base: 'pages' },
        attachment: { name: 'Media', rest_base: 'media' },
      }),
    });
    global.fetch = fetchMock as any;
    const provider = new WordpressProvider();
    const rawCode = Buffer.from(
      JSON.stringify({
        domain: 'https://wp.example.com',
        username: 'editor',
        password: 'application-password',
      })
    ).toString('base64');
    const encrypted = AuthService.encryptSecret(rawCode);

    await expect(provider.postTypes(encrypted)).resolves.toEqual([
      { id: 'posts', name: 'Posts' },
      { id: 'pages', name: 'Pages' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wp.example.com/wp-json/wp/v2/types',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
        dispatcher: expect.anything(),
        headers: {
          Authorization: `Basic ${Buffer.from(
            'editor:application-password'
          ).toString('base64')}`,
        },
      })
    );
  });

  it('refuses to publish to a REST route not exposed as a WordPress post type', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        post: { name: 'Posts', rest_base: 'posts' },
      }),
    });
    global.fetch = fetchMock as any;
    const provider = new WordpressProvider();
    const rawCode = Buffer.from(
      JSON.stringify({
        domain: 'https://wp.example.com',
        username: 'editor',
        password: 'application-password',
      })
    ).toString('base64');
    const encrypted = AuthService.encryptSecret(rawCode);

    await expect(
      provider.post(
        'integration_1',
        encrypted,
        [
          {
            id: 'post_1',
            message: 'Body',
            settings: { title: 'Title', type: 'users' },
          },
        ],
        {} as any
      )
    ).rejects.toThrow('Selected WordPress post type is not available');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards the complete blog contract to the WordPress REST API', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          post: { name: 'Posts', rest_base: 'posts' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 42,
          link: 'https://wp.example.com/complete-article',
        }),
      });
    global.fetch = fetchMock as any;
    const provider = new WordpressProvider();
    const rawCode = Buffer.from(
      JSON.stringify({
        domain: 'https://wp.example.com',
        username: 'editor',
        password: 'application-password',
      })
    ).toString('base64');

    await expect(
      provider.post(
        'integration_1',
        AuthService.encryptSecret(rawCode),
        [
          {
            id: 'post_1',
            message: '<h2>Complete body</h2>',
            settings: {
              title: 'Complete article',
              type: 'posts',
              slug: 'complete-article',
              excerpt: 'Summary',
              status: 'private',
              author: 7,
              parent: 0,
              menu_order: 3,
              comment_status: 'closed',
              ping_status: 'closed',
              format: 'standard',
              template: 'single-special.php',
              sticky: true,
              password: 'reader-password',
              categories: [2, 8],
              tags: [4],
              meta: { campaign: 'launch' },
              seo_plugin: 'yoast',
              seo_title: 'SEO title',
              seo_description: 'SEO description',
              focus_keyword: 'article',
              canonical_url: 'https://wp.example.com/complete-article',
              robots_index: false,
              robots_follow: true,
              og_title: 'OG title',
              og_description: 'OG description',
            },
          },
        ],
        {} as any
      )
    ).resolves.toEqual([
      {
        id: 'post_1',
        status: 'completed',
        postId: '42',
        releaseURL: 'https://wp.example.com/complete-article',
      },
    ]);

    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe('https://wp.example.com/wp-json/wp/v2/posts');
    expect(JSON.parse(request[1].body)).toEqual({
      title: 'Complete article',
      content: '<h2>Complete body</h2>',
      slug: 'complete-article',
      status: 'private',
      excerpt: 'Summary',
      author: 7,
      parent: 0,
      menu_order: 3,
      comment_status: 'closed',
      ping_status: 'closed',
      format: 'standard',
      template: 'single-special.php',
      sticky: true,
      password: 'reader-password',
      categories: [2, 8],
      tags: [4],
      meta: {
        _yoast_wpseo_title: 'SEO title',
        _yoast_wpseo_metadesc: 'SEO description',
        _yoast_wpseo_focuskw: 'article',
        _yoast_wpseo_canonical: 'https://wp.example.com/complete-article',
        '_yoast_wpseo_meta-robots-noindex': '1',
        _yoast_wpseo_opengraph_title: 'OG title',
        _yoast_wpseo_opengraph_description: 'OG description',
        campaign: 'launch',
      },
    });
  });

  it('imports managed inline images and preserves their positions in the article', async () => {
    const cover = 'https://postiz.example/uploads/cover.jpg';
    const firstInline =
      'https://postiz.example/uploads/first-inline.jpg?quality=80&format=webp';
    const secondInline = 'https://postiz.example/uploads/second-inline.jpg';
    const imageBlob = { type: 'image/jpeg' } as Blob;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          post: { name: 'Posts', rest_base: 'posts' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => imageBlob,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 100,
          source_url: 'https://wp.example.com/uploads/cover.jpg',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => imageBlob,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 101,
          source_url:
            'https://wp.example.com/uploads/first-inline.jpg?converted=1&size=large',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => imageBlob,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 102,
          source_url: 'https://wp.example.com/uploads/second-inline.jpg',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 42,
          link: 'https://wp.example.com/article-with-images',
        }),
      });
    global.fetch = fetchMock as any;
    const provider = new WordpressProvider();
    const rawCode = Buffer.from(
      JSON.stringify({
        domain: 'https://wp.example.com',
        username: 'editor',
        password: 'application-password',
      })
    ).toString('base64');
    const content = `<p>Before</p><img src="${firstInline.replace(
      '&',
      '&amp;'
    )}" alt="First"><p>Between</p><img src="${secondInline}" alt="Second"><p>After</p>`;

    await provider.post(
      'integration_1',
      AuthService.encryptSecret(rawCode),
      [
        {
          id: 'post_1',
          message: content,
          media: [
            { type: 'image', path: cover },
            { type: 'image', path: firstInline },
            { type: 'image', path: secondInline },
          ],
          settings: {
            title: 'Article with images',
            type: 'posts',
            main_image: { path: cover },
          },
        },
      ],
      {} as any
    );

    const mediaUploads = fetchMock.mock.calls.filter(
      ([url, options]) =>
        url === 'https://wp.example.com/wp-json/wp/v2/media' &&
        options?.method === 'POST'
    );
    expect(mediaUploads).toHaveLength(3);

    const request = fetchMock.mock.calls.at(-1);
    expect(request[0]).toBe('https://wp.example.com/wp-json/wp/v2/posts');
    expect(JSON.parse(request[1].body)).toMatchObject({
      content:
        '<p>Before</p><img src="https://wp.example.com/uploads/first-inline.jpg?converted=1&amp;size=large" alt="First"><p>Between</p><img src="https://wp.example.com/uploads/second-inline.jpg" alt="Second"><p>After</p>',
      featured_media: 100,
    });
    expect(JSON.parse(request[1].body).content).not.toContain('postiz.example');
  });

  it('does not report completion when WordPress rejects the post', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          post: { name: 'Posts', rest_base: 'posts' },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid category id' }),
        text: async () => JSON.stringify({ message: 'Invalid category id' }),
      });
    global.fetch = fetchMock as any;
    const provider = new WordpressProvider();
    const rawCode = Buffer.from(
      JSON.stringify({
        domain: 'https://wp.example.com',
        username: 'editor',
        password: 'application-password',
      })
    ).toString('base64');

    await expect(
      provider.post(
        'integration_1',
        AuthService.encryptSecret(rawCode),
        [
          {
            id: 'post_1',
            message: 'Body',
            settings: { title: 'Title', type: 'posts' },
          },
        ],
        {} as any
      )
    ).rejects.toThrow('Invalid category id');
  });

  it('detects tampering in encrypted credentials', () => {
    const encrypted = AuthService.encryptSecret('sensitive');
    const tampered = `${encrypted.slice(0, -1)}${
      encrypted.endsWith('A') ? 'B' : 'A'
    }`;

    expect(() => AuthService.decryptSecret(tampered)).toThrow();
  });
});
