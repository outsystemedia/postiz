// DesignerPRO addition — not upstream Postiz code.
//
// Targeted unit tests for the group (Customer) lifecycle methods added to
// IntegrationRepository for the DesignerPRO Public API fork. Does not attempt
// to cover the rest of this file's (pre-existing, untested) upstream methods.
import { IntegrationRepository } from './integration.repository';

function buildRepository() {
  const integrationModel = {
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  };
  const postModel = { updateMany: jest.fn() };
  const customerModel = {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  };

  const integrations = { model: { integration: integrationModel } } as any;
  const posts = { model: { post: postModel } } as any;
  const customers = { model: { customer: customerModel } } as any;
  // Unused by the methods under test — untyped stand-ins are sufficient.
  const unused = {} as any;

  const repository = new IntegrationRepository(
    integrations, // _integration
    posts, // _posts
    unused, // _plugs
    unused, // _exisingPlugData
    customers, // _customers
    unused // _mentions
  );

  return { repository, customerModel, integrationModel, postModel };
}

describe('IntegrationRepository — DesignerPRO group (Customer) additions', () => {
  it('reactivates both new and reconnected integrations during authentication upsert', async () => {
    const { repository, integrationModel } = buildRepository();
    integrationModel.upsert.mockResolvedValue({ id: 'int_1' });

    await repository.createOrUpdateIntegration(
      undefined,
      false,
      'org_1',
      'My channel',
      undefined,
      'social',
      'external_1',
      'threads',
      'fresh-token'
    );

    expect(integrationModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ disabled: false }),
        update: expect.objectContaining({ disabled: false }),
      })
    );
  });

  it('createCustomer creates a Customer scoped to the given org', async () => {
    const { repository, customerModel } = buildRepository();
    customerModel.create.mockResolvedValue({ id: 'cust_1', name: 'Acme' });

    const result = await repository.createCustomer('org_1', 'Acme');

    expect(customerModel.create).toHaveBeenCalledWith({
      data: { name: 'Acme', orgId: 'org_1' },
    });
    expect(result).toEqual({ id: 'cust_1', name: 'Acme' });
  });

  it('renameCustomer scopes the update to id + orgId', async () => {
    const { repository, customerModel } = buildRepository();
    customerModel.update.mockResolvedValue({ id: 'cust_1', name: 'New name' });

    await repository.renameCustomer('org_1', 'cust_1', 'New name');

    expect(customerModel.update).toHaveBeenCalledWith({
      where: { id: 'cust_1', orgId: 'org_1' },
      data: { name: 'New name' },
    });
  });

  it("renameCustomer scoped to a different org will not match another org's customer row", async () => {
    // Prisma resolves `where: { id, orgId }` as an AND filter — a row that
    // exists under a different orgId simply won't match, so this asserts the
    // call shape enforces that scoping rather than only filtering by id.
    const { repository, customerModel } = buildRepository();
    customerModel.update.mockResolvedValue({ id: 'cust_1', name: 'Hijacked' });

    await repository.renameCustomer('org_attacker', 'cust_1', 'Hijacked');

    expect(customerModel.update).toHaveBeenCalledWith({
      where: { id: 'cust_1', orgId: 'org_attacker' },
      data: { name: 'Hijacked' },
    });
  });

  it('deleteCustomer soft-deletes by setting deletedAt, scoped to org', async () => {
    const { repository, customerModel } = buildRepository();
    const now = new Date('2026-07-15T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    customerModel.update.mockResolvedValue({ id: 'cust_1', deletedAt: now });

    await repository.deleteCustomer('org_1', 'cust_1');

    expect(customerModel.update).toHaveBeenCalledWith({
      where: { id: 'cust_1', orgId: 'org_1' },
      data: { deletedAt: now },
    });
    jest.useRealTimers();
  });

  it('getCustomer only matches non-deleted rows scoped to the given org', async () => {
    const { repository, customerModel } = buildRepository();
    customerModel.findFirst.mockResolvedValue({ id: 'cust_1', name: 'Acme' });

    await repository.getCustomer('org_1', 'cust_1');

    expect(customerModel.findFirst).toHaveBeenCalledWith({
      where: { id: 'cust_1', orgId: 'org_1', deletedAt: null },
    });
  });
});

describe('IntegrationRepository — credential and Meta deletion', () => {
  afterEach(() => jest.useRealTimers());

  it('wipes stored credentials when a channel is disconnected', async () => {
    const { repository, integrationModel } = buildRepository();
    const now = new Date('2026-10-26T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    integrationModel.update.mockResolvedValue({ id: 'int_1' });

    await repository.deleteChannel('org_1', 'int_1');

    expect(integrationModel.update).toHaveBeenCalledWith({
      where: { id: 'int_1', organizationId: 'org_1' },
      data: {
        deletedAt: now,
        disabled: true,
        refreshNeeded: false,
        inBetweenSteps: false,
        token: '',
        refreshToken: null,
        tokenExpiration: null,
        customInstanceDetails: null,
      },
    });
  });

  it('anonymizes Meta integrations and their queued post data by signed user id', async () => {
    const { repository, integrationModel, postModel } = buildRepository();
    integrationModel.findMany.mockResolvedValue([
      { id: 'int_fb' },
      { id: 'int_ig' },
    ]);
    integrationModel.updateMany.mockResolvedValue({ count: 2 });
    postModel.updateMany.mockResolvedValue({ count: 3 });

    await expect(
      repository.deleteMetaUserData('meta-user-1', ['facebook', 'instagram'])
    ).resolves.toEqual({ deleted: 2 });

    expect(integrationModel.findMany).toHaveBeenCalledWith({
      where: {
        providerIdentifier: { in: ['facebook', 'instagram'] },
        OR: [{ rootInternalId: 'meta-user-1' }, { internalId: 'meta-user-1' }],
      },
      select: { id: true },
    });
    expect(postModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { integrationId: { in: ['int_fb', 'int_ig'] } },
      })
    );
    expect(integrationModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['int_fb', 'int_ig'] } },
        data: expect.objectContaining({
          token: '',
          refreshToken: null,
          rootInternalId: null,
          disabled: true,
        }),
      })
    );
  });
});
