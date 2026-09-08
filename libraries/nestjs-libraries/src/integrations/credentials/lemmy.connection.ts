// DesignerPRO addition (2026-09-08). Reuses the existing Lemmy API v3 contract.
import {
  CredentialConnection,
  CredentialError,
  credentialJson,
  required,
  serviceUrl,
} from './credential.connection';
async function login(fields: Record<string, string>) {
  const service = await serviceUrl(fields.service);
  const result = await credentialJson(
    `${service}/api/v3/user/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username_or_email: fields.identifier,
        password: fields.password,
      }),
    },
    'Usuário ou senha Lemmy inválidos, ou a instância não oferece login pela API v3.'
  );
  if (typeof result.jwt !== 'string' || !result.jwt)
    throw new CredentialError(
      'Login Lemmy recusado. Verifique usuário, senha e os requisitos de autenticação da instância.'
    );
  return { service, jwt: result.jwt };
}
export const lemmyConnection: CredentialConnection = {
  async customFields() {
    return [
      { key: 'service', label: 'Instance URL', type: 'text' },
      { key: 'identifier', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ];
  },
  async authenticate(fields) {
    const credentials = {
      service: await serviceUrl(required(fields, 'service').trim()),
      identifier: required(fields, 'identifier', 200).trim(),
      password: required(fields, 'password', 512),
    };
    const { service, jwt } = await login(credentials);
    // /site resolves the authenticated user even when login used an email.
    const site = await credentialJson(`${service}/api/v3/site`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const person = site.my_user?.local_user_view?.person;
    if (!person?.id || !person.name)
      throw new CredentialError(
        'A instância não confirmou o usuário autenticado.'
      );
    return {
      id: `${service}/${person.id}`,
      name: person.display_name || person.name,
      username: person.name,
      credentials,
    };
  },
  async post(_provider, auth, posts, _integration, reply) {
    const { service, jwt } = await login(auth.credentials);
    const [post] = posts;
    const headers = {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    };
    if (reply) {
      const ids = reply.root.split(',');
      const results = await Promise.all(
        ids.map(async (id) => {
          const result = await credentialJson(`${service}/api/v3/comment`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              post_id: Number(id),
              content: post.message,
            }),
          });
          if (!result.comment_view?.comment?.id)
            throw new CredentialError(
              'A instância não confirmou o comentário.'
            );
          return result.comment_view.comment.id;
        })
      );
      return [
        {
          id: post.id,
          postId: results.join(','),
          releaseURL: results.map((id) => `${service}/comment/${id}`).join(','),
          status: 'completed',
        },
      ];
    }
    const settings = post.settings as any;
    if (!settings.subreddit?.length)
      throw new CredentialError(
        'Informe a comunidade e o título da publicação Lemmy.'
      );
    const results = [];
    for (const { value } of settings.subreddit) {
      const result = await credentialJson(`${service}/api/v3/post`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          community_id: Number(value.id),
          name: value.title,
          body: post.message,
          nsfw: false,
          ...(value.url ? { url: value.url } : {}),
          ...(post.media?.[0] ? { custom_thumbnail: post.media[0].path } : {}),
        }),
      });
      if (!result.post_view?.post?.id)
        throw new CredentialError('A instância não confirmou a publicação.');
      results.push(String(result.post_view.post.id));
    }
    return [
      {
        id: post.id,
        postId: results.join(','),
        releaseURL: results.map((id) => `${service}/post/${id}`).join(','),
        status: 'completed',
      },
    ];
  },
};
