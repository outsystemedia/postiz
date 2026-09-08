// DesignerPRO addition (2026-09-08). NIP-19 keys and acknowledged NIP-01 events.
import { getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import dns from 'node:dns';
import { isBlockedIp } from '../../dtos/webhooks/webhook.url.validator';
import {
  CredentialConnection,
  CredentialError,
  required,
  serviceUrl,
} from './credential.connection';

export function nostrSecret(value: string): Uint8Array {
  try {
    const decoded = nip19.decode(value);
    if (decoded.type !== 'nsec' || decoded.data.length !== 32)
      throw new Error();
    getPublicKey(decoded.data); // Reject zero and out-of-range secp256k1 scalars.
    return decoded.data;
  } catch {
    throw new CredentialError(
      'Chave privada Nostr inválida. Informe uma chave nsec completa.'
    );
  }
}
async function relaysFor(value: string) {
  const relays = [
    ...new Set(
      (value || 'wss://relay.damus.io,wss://nos.lol')
        .split(/[\s,]+/)
        .filter(Boolean)
    ),
  ];
  if (!relays.length || relays.length > 8)
    throw new CredentialError('Informe entre 1 e 8 relays públicos wss://.');
  for (const relay of relays) {
    let url: URL;
    try {
      url = new URL(relay);
    } catch {
      throw new CredentialError('Relay inválido. Use wss://.');
    }
    if (
      url.protocol !== 'wss:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new CredentialError('Relay inválido. Use wss:// sem credenciais.');
    await serviceUrl('https://' + url.host);
  }
  return relays;
}
export async function publishNostrEvent(
  relay: string,
  event: ReturnType<typeof finalizeEvent>
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Validate DNS again at connection time, closing DNS-rebinding gaps.
    const socket = new WebSocket(relay, {
      handshakeTimeout: 8000,
      followRedirects: false,
      lookup(host, options, callback) {
        dns.lookup(host, options, (err, addresses: any, family) => {
          const entries = Array.isArray(addresses)
            ? addresses
            : [{ address: addresses }];
          if (err || entries.some((p) => !p.address || isBlockedIp(p.address)))
            return callback(new Error('Relay unavailable'), '', 0);
          callback(null, addresses, family);
        });
      },
    });
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.terminate();
      ok
        ? resolve()
        : reject(new CredentialError('O relay não confirmou a publicação.'));
    };
    const timeout = setTimeout(() => finish(false), 10000);
    socket.on('open', () => socket.send(JSON.stringify(['EVENT', event])));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message[0] === 'OK' && message[1] === event.id)
          finish(message[2] === true);
      } catch {
        /* Ignore unrelated relay frames. */
      }
    });
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}
export const nostrConnection: CredentialConnection = {
  async customFields() {
    return [
      { key: 'privateKey', label: 'Private key (nsec)', type: 'password' },
      {
        key: 'relays',
        label: 'Relays',
        type: 'text',
        required: false,
        defaultValue: 'wss://relay.damus.io, wss://nos.lol',
      },
    ];
  },
  async authenticate(fields) {
    const privateKey = required(fields, 'privateKey', 100).trim();
    const id = getPublicKey(nostrSecret(privateKey));
    const relays = await relaysFor(fields.relays);
    return {
      id,
      name: `Nostr ${id.slice(0, 12)}`,
      username: nip19.npubEncode(id),
      credentials: { privateKey, relays: relays.join(',') },
    };
  },
  async post(_provider, auth, posts, _integration, reply) {
    const [post] = posts;
    const event = finalizeEvent(
      {
        kind: 1,
        content: [post.message, ...(post.media || []).map((m) => m.path)]
          .filter(Boolean)
          .join('\n\n'),
        created_at: Math.floor(Date.now() / 1000),
        tags: reply
          ? [
              ['e', reply.root, '', 'root'],
              ...(reply.last && reply.last !== reply.root
                ? [['e', reply.last, '', 'reply']]
                : []),
              ['p', auth.id],
            ]
          : [],
      },
      nostrSecret(auth.credentials.privateKey)
    );
    const results = await Promise.allSettled(
      (
        await relaysFor(auth.credentials.relays)
      ).map((relay) => publishNostrEvent(relay, event))
    );
    if (!results.some((result) => result.status === 'fulfilled'))
      throw new CredentialError(
        'Nenhum relay confirmou a publicação. Verifique os relays e tente novamente.'
      );
    return [
      {
        id: post.id,
        postId: event.id,
        releaseURL: `https://primal.net/e/${event.id}`,
        status: 'completed',
      },
    ];
  },
};
