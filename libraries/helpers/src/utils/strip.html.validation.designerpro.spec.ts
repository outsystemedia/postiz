// DesignerPRO addition — keep inline article images through the worker's HTML formatter.
import { stripHtmlValidation } from './strip.html.validation';

describe('stripHtmlValidation — DesignerPRO inline media', () => {
  it('preserves only safe src and alt attributes on inline images for HTML providers', () => {
    const result = stripHtmlValidation(
      'html',
      '<p>Before</p><img src="https://postiz.example/uploads/article.jpg" alt="Article image" data-media-id="internal-id" class="wide" onerror="alert(1)"><img src="javascript:alert(1)" alt="Unsafe"><p>After</p>'
    );

    expect(result).toContain(
      '<img src="https://postiz.example/uploads/article.jpg" alt="Article image">'
    );
    expect(result).toContain('<img alt="Unsafe">');
    expect(result).not.toContain('data-media-id');
    expect(result).not.toContain('class="wide"');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('javascript:');
  });
});
