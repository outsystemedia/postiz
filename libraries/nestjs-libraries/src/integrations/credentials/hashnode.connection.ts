// DesignerPRO addition (2026-09-08). Hashnode retired its free API in May 2026.
import {
  CredentialConnection,
  CredentialError,
  credentialJson,
  required,
} from './credential.connection';
const endpoint = 'https://gql-beta.hashnode.com';
export async function hashnodeQuery(
  token: string,
  query: string,
  variables: Record<string, unknown> = {}
) {
  const result = await credentialJson(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    },
    'PAT Hashnode inválido ou sem acesso à publicação.'
  );
  if (result.errors?.length) {
    if (
      result.errors.some((e: any) =>
        /pro plan|active pro|upgrade/i.test(String(e.message))
      )
    )
      throw new CredentialError(
        'O Hashnode exige plano Pro nesta publicação para usar a API. Este canal não oferece conexão gratuita.'
      );
    if (
      result.errors.some((e: any) => e.extensions?.code === 'UNAUTHENTICATED')
    )
      throw new CredentialError('Personal Access Token Hashnode inválido.');
    throw new CredentialError(
      'O Hashnode recusou a operação. Verifique a publicação, seu plano e suas permissões.'
    );
  }
  if (!result.data)
    throw new CredentialError('O Hashnode não confirmou a operação.');
  return result.data;
}
export const hashnodeConnection: CredentialConnection = {
  async customFields() {
    return [
      {
        key: 'personalAccessToken',
        label: 'Personal Access Token',
        type: 'password',
      },
      { key: 'publicationId', label: 'Publication ID', type: 'text' },
    ];
  },
  async authenticate(fields) {
    const token = required(fields, 'personalAccessToken', 4096).trim();
    const publicationId = required(fields, 'publicationId', 24).trim();
    if (!/^[a-f0-9]{24}$/i.test(publicationId))
      throw new CredentialError('Publication ID Hashnode inválido.');
    const data = await hashnodeQuery(
      token,
      'query($id: ObjectId!) { me { id name username } publication(id: $id) { id title author { id } } }',
      { id: publicationId }
    );
    if (!data.me?.id || data.publication?.id !== publicationId)
      throw new CredentialError('PAT inválido ou publicação não encontrada.');
    if (data.publication.author.id !== data.me.id) {
      let after: string | null = null;
      let permitted = false;
      for (let page = 0; page < 20; page++) {
        const result = await hashnodeQuery(
          token,
          'query($id: ObjectId!, $after: String) { publication(id: $id) { members(first: 100, after: $after) { edges { node { user { id } role } } pageInfo { hasNextPage endCursor } } } }',
          { id: publicationId, after }
        );
        const members = result.publication?.members;
        permitted = members?.edges?.some(
          (e: any) =>
            e.node.user.id === data.me.id &&
            ['OWNER', 'EDITOR', 'ADMIN', 'AUTHOR'].includes(
              String(e.node.role).toUpperCase()
            )
        );
        if (permitted || !members?.pageInfo?.hasNextPage) break;
        after = members.pageInfo.endCursor;
      }
      if (!permitted)
        throw new CredentialError(
          'Não foi possível confirmar permissão para publicar. Use um PAT do proprietário ou de um editor com participação visível.'
        );
    }
    return {
      id: publicationId,
      name: data.publication.title || data.me.name,
      username: data.me.username,
      token,
      credentials: { publicationId },
    };
  },
  async post(_provider, auth, posts, _integration, reply) {
    if (reply)
      throw new CredentialError(
        'Hashnode não suporta respostas automáticas nesta conexão.'
      );
    const [post] = posts;
    const settings = post.settings as any;
    const result = await hashnodeQuery(
      auth.token!,
      'mutation($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }',
      {
        input: {
          publicationId: auth.credentials.publicationId,
          title: settings.title,
          contentMarkdown: post.message,
          tags: (settings.tags || []).map((tag: any) => ({ slug: tag.value })),
          ...(settings.main_image?.path
            ? { coverImage: settings.main_image.path }
            : {}),
        },
      }
    );
    const published = result.publishPost?.post;
    if (!published?.id || !published.url)
      throw new CredentialError('O Hashnode não confirmou a publicação.');
    return [
      {
        id: post.id,
        postId: published.id,
        releaseURL: published.url,
        status: 'completed',
      },
    ];
  },
};
