import { createHmac, timingSafeEqual } from 'crypto';

type MetaSignedRequestPayload = {
  algorithm?: string;
  app_id?: string | number;
  user_id?: string | number;
};

export type MetaDeletionApp = {
  appId?: string;
  appSecret: string;
  providers: string[];
};

export type VerifiedMetaDeletionRequest = {
  userId: string;
  providers: string[];
};

/** Validate Meta's base64url payload with HMAC-SHA256 before trusting user_id. */
export function verifyMetaDeletionSignedRequest(
  signedRequest: string,
  apps: MetaDeletionApp[]
): VerifiedMetaDeletionRequest {
  const [encodedSignature, encodedPayload, extra] = String(
    signedRequest ?? ''
  ).split('.');
  if (!encodedSignature || !encodedPayload || extra) {
    throw new Error('Invalid Meta signed_request format');
  }

  const actualSignature = Buffer.from(encodedSignature, 'base64url');
  for (const app of apps.filter((item) => item.appSecret)) {
    const expectedSignature = createHmac('sha256', app.appSecret)
      .update(encodedPayload)
      .digest();
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      continue;
    }

    let payload: MetaSignedRequestPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8')
      );
    } catch {
      throw new Error('Invalid Meta signed_request payload');
    }

    if (String(payload.algorithm ?? '').toUpperCase() !== 'HMAC-SHA256') {
      throw new Error('Unsupported Meta signed_request algorithm');
    }
    if (
      app.appId &&
      payload.app_id !== undefined &&
      String(payload.app_id) !== app.appId
    ) {
      // Multiple Meta products can share an app secret. Keep looking for the
      // matching app id rather than rejecting a valid request too early.
      continue;
    }
    if (!payload.user_id) {
      throw new Error('Meta signed_request does not contain user_id');
    }

    return { userId: String(payload.user_id), providers: app.providers };
  }

  throw new Error('Invalid Meta signed_request signature');
}
