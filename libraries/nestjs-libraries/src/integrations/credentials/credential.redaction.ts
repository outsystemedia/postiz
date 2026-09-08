// DesignerPRO addition — remove credential material from Sentry telemetry.
const secretKey =
  /^(?:authorization|cookie|set-cookie|password|privateKey|botToken|accessToken|refreshToken|apiKey|api-key|personalAccessToken|webhookUrl|credentials|customInstanceDetails|token)$/i;
export function redactCredentialTelemetry(value: unknown, depth = 0): any {
  if (depth > 12) return '[truncated]';
  if (typeof value === 'string' && /^[\s]*[\[{]/.test(value)) {
    try {
      return JSON.stringify(
        redactCredentialTelemetry(JSON.parse(value), depth + 1)
      );
    } catch {
      /* Non-JSON diagnostic string. */
    }
  }
  if (typeof value === 'string')
    return value
      .replace(/(\/bot)[0-9]+:[A-Za-z0-9_-]+/g, '$1[redacted]')
      .replace(/(\/webhooks\/\d+\/)[A-Za-z0-9_-]+/g, '$1[redacted]')
      .replace(/\bnsec1[023456789acdefghjklmnpqrstuvwxyz]+\b/g, '[redacted]');
  if (Array.isArray(value))
    return value.map((item) => redactCredentialTelemetry(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKey.test(key)
          ? '[redacted]'
          : redactCredentialTelemetry(item, depth + 1),
      ])
    );
  return value;
}
