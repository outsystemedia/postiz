import { ValidUrlExtension } from './valid.url.path';

describe('ValidUrlExtension — DesignerPRO media formats', () => {
  const validator = new ValidUrlExtension();

  it('accepts AVIF paths re-hosted by the Postiz upload API', () => {
    expect(
      validator.validate(
        'https://postiz.example/uploads/2026/10/article.avif?cache=1',
        {} as never
      )
    ).toBe(true);
  });

  it('continues rejecting unsupported file extensions', () => {
    expect(
      validator.validate('https://postiz.example/uploads/article.svg', {} as never)
    ).toBe(false);
  });
});
