// DesignerPRO addition — regression coverage for inline article images.
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: jest.fn((value: unknown) => String(value)) },
}));

import DOMPurify from 'isomorphic-dompurify';
import { sanitizePostContent } from './sanitize.post.content';

describe('sanitizePostContent — DesignerPRO inline media', () => {
  it('passes safe inline image rules and a restrictive URL policy to DOMPurify', () => {
    const content = sanitizePostContent(
      '<p>Intro</p><img src="https://postiz.example/uploads/article.jpg" alt="Article image" onerror="alert(1)"><img src="javascript:alert(1)" alt="Unsafe">'
    );

    expect(content).toContain(
      'src="https://postiz.example/uploads/article.jpg"'
    );
    const sanitize = DOMPurify.sanitize as jest.Mock;
    const options = sanitize.mock.calls.at(-1)?.[1];
    expect(options.ALLOWED_TAGS).toContain('img');
    expect(options.ALLOWED_ATTR).toEqual(
      expect.arrayContaining(['src', 'alt'])
    );
    expect(
      options.ALLOWED_URI_REGEXP.test('https://postiz.example/image.jpg')
    ).toBe(true);
    expect(options.ALLOWED_URI_REGEXP.test('javascript:alert(1)')).toBe(false);
  });
});
