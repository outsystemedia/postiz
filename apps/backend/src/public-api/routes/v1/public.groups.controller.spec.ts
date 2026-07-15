// DesignerPRO addition — not upstream Postiz code.
//
// Targeted unit tests for the four new Public API group (Customer) endpoints.
// Constructed directly (no NestJS TestingModule) since PublicGroupsController
// takes a single constructor dependency — these are plain unit tests of the
// controller's own logic (validation, org-scoped ownership checks) with
// IntegrationService mocked out.
import { HttpException } from '@nestjs/common';
import type { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// Avoid depending on the real Sentry SDK's uninitialized-safe-no-op behavior
// in a unit test — each handler calls Sentry.metrics.count() as a side effect.
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

// The real IntegrationService module transitively imports integration.manager.ts,
// which registers every social provider — including nostr.provider.ts, which
// depends on the ESM-only `nostr-tools` package that Jest's default CJS
// transform can't parse. This controller only needs IntegrationService's
// *type* here (a hand-built mock object is used below, not auto-mocking), so
// stub the module with an explicit factory to keep the real file — and its
// entire provider registry — from ever loading in this test.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: jest.fn() })
);

// ts-jest hoists the jest.mock() call above this import, so the real module
// is never evaluated.
import { PublicGroupsController } from './public.groups.controller';

const ORG = { id: 'org_1' } as any;

function buildController() {
  const integrationService = {
    createCustomer: jest.fn(),
    renameCustomer: jest.fn(),
    deleteCustomer: jest.fn(),
    getCustomer: jest.fn(),
    updateIntegrationGroup: jest.fn(),
  } as unknown as jest.Mocked<IntegrationService>;

  const controller = new PublicGroupsController(integrationService);
  return { controller, integrationService };
}

describe('PublicGroupsController', () => {
  describe('POST /groups', () => {
    it('rejects an empty name with 400', async () => {
      const { controller } = buildController();
      await expect(controller.createGroup(ORG, { name: '  ' })).rejects.toThrow(
        HttpException
      );
    });

    it('creates a customer scoped to the caller\'s org and returns id/name', async () => {
      const { controller, integrationService } = buildController();
      integrationService.createCustomer.mockResolvedValue({
        id: 'cust_1',
        name: 'Acme',
      } as any);

      const result = await controller.createGroup(ORG, { name: 'Acme' });

      expect(integrationService.createCustomer).toHaveBeenCalledWith(
        'org_1',
        'Acme'
      );
      expect(result).toEqual({ id: 'cust_1', name: 'Acme' });
    });
  });

  describe('PUT /groups/:id', () => {
    it('returns 404 when the group does not belong to (or exist in) the caller\'s org', async () => {
      const { controller, integrationService } = buildController();
      integrationService.getCustomer.mockResolvedValue(null);

      await expect(
        controller.renameGroup(ORG, 'cust_other_org', { name: 'New name' })
      ).rejects.toThrow(HttpException);
      expect(integrationService.renameCustomer).not.toHaveBeenCalled();
    });

    it('renames when the group is owned by the caller\'s org', async () => {
      const { controller, integrationService } = buildController();
      integrationService.getCustomer.mockResolvedValue({ id: 'cust_1' } as any);
      integrationService.renameCustomer.mockResolvedValue({
        id: 'cust_1',
        name: 'New name',
      } as any);

      const result = await controller.renameGroup(ORG, 'cust_1', {
        name: 'New name',
      });

      expect(integrationService.renameCustomer).toHaveBeenCalledWith(
        'org_1',
        'cust_1',
        'New name'
      );
      expect(result).toEqual({ id: 'cust_1', name: 'New name' });
    });
  });

  describe('DELETE /groups/:id', () => {
    it('returns 404 for a group outside the caller\'s org', async () => {
      const { controller, integrationService } = buildController();
      integrationService.getCustomer.mockResolvedValue(null);

      await expect(controller.deleteGroup(ORG, 'cust_x')).rejects.toThrow(
        HttpException
      );
      expect(integrationService.deleteCustomer).not.toHaveBeenCalled();
    });

    it('deletes when owned by the caller\'s org', async () => {
      const { controller, integrationService } = buildController();
      integrationService.getCustomer.mockResolvedValue({ id: 'cust_1' } as any);

      const result = await controller.deleteGroup(ORG, 'cust_1');

      expect(integrationService.deleteCustomer).toHaveBeenCalledWith(
        'org_1',
        'cust_1'
      );
      expect(result).toEqual({ id: 'cust_1', deleted: true });
    });
  });

  describe('PUT /integrations/:id/group — the cross-org ownership fix', () => {
    it('rejects assignment to a group id belonging to a different organization', async () => {
      const { controller, integrationService } = buildController();
      // Simulates the exact gap found in upstream `updateIntegrationGroup`:
      // the target group id exists, but not under this caller's org.
      integrationService.getCustomer.mockResolvedValue(null);

      await expect(
        controller.assignIntegrationGroup(ORG, 'integration_1', {
          groupId: 'cust_belongs_to_other_org',
        })
      ).rejects.toThrow(HttpException);
      expect(integrationService.updateIntegrationGroup).not.toHaveBeenCalled();
    });

    it('assigns when the group is verified to belong to the caller\'s org', async () => {
      const { controller, integrationService } = buildController();
      integrationService.getCustomer.mockResolvedValue({ id: 'cust_1' } as any);

      const result = await controller.assignIntegrationGroup(
        ORG,
        'integration_1',
        { groupId: 'cust_1' }
      );

      expect(integrationService.getCustomer).toHaveBeenCalledWith(
        'org_1',
        'cust_1'
      );
      expect(integrationService.updateIntegrationGroup).toHaveBeenCalledWith(
        'org_1',
        'integration_1',
        'cust_1'
      );
      expect(result).toEqual({ id: 'integration_1', groupId: 'cust_1' });
    });

    it('allows unassigning (empty groupId) without an ownership lookup, matching upstream disconnect semantics', async () => {
      const { controller, integrationService } = buildController();

      const result = await controller.assignIntegrationGroup(
        ORG,
        'integration_1',
        { groupId: '' }
      );

      expect(integrationService.getCustomer).not.toHaveBeenCalled();
      expect(integrationService.updateIntegrationGroup).toHaveBeenCalledWith(
        'org_1',
        'integration_1',
        ''
      );
      expect(result).toEqual({ id: 'integration_1', groupId: null });
    });
  });
});
