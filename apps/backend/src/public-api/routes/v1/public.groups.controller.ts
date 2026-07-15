// DesignerPRO addition — not upstream Postiz code.
//
// Adds the missing Customer/Group lifecycle to the Public API. Upstream Postiz
// only exposes `GET /public/v1/groups` (list). Creating, renaming, deleting a
// group, and assigning an integration to one are otherwise only reachable
// through Postiz's session-authenticated frontend routes
// (`GET/PUT /integrations/customers`, `/integrations/:id/customer-name`,
// `/integrations/:id/group`). These four endpoints are thin wrappers around
// the exact same underlying IntegrationService/IntegrationRepository methods
// those internal routes already use (see integration.repository.ts additions),
// exposed under the same PublicAuthMiddleware/API-key guard as every other
// `/public/v1/*` route — no new trust mechanism is introduced.
//
// Kept in its own file, registered via a single addition to
// PublicApiModule's controller array, so upstream rebases only ever touch
// that one line here rather than this file's contents.
import { Body, Controller, Delete, HttpException, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import * as Sentry from '@sentry/nestjs';

@ApiTags('Public API')
@Controller('/public/v1')
export class PublicGroupsController {
  constructor(private _integrationService: IntegrationService) {}

  @Post('/groups')
  async createGroup(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { name: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const name = (body?.name || '').trim();
    if (!name) {
      throw new HttpException({ msg: 'name is required' }, 400);
    }

    const customer = await this._integrationService.createCustomer(org.id, name);
    return { id: customer.id, name: customer.name };
  }

  @Put('/groups/:id')
  async renameGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const name = (body?.name || '').trim();
    if (!name) {
      throw new HttpException({ msg: 'name is required' }, 400);
    }

    const existing = await this._integrationService.getCustomer(org.id, id);
    if (!existing) {
      throw new HttpException({ msg: 'Group not found' }, 404);
    }

    const customer = await this._integrationService.renameCustomer(org.id, id, name);
    return { id: customer.id, name: customer.name };
  }

  @Delete('/groups/:id')
  async deleteGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const existing = await this._integrationService.getCustomer(org.id, id);
    if (!existing) {
      throw new HttpException({ msg: 'Group not found' }, 404);
    }

    await this._integrationService.deleteCustomer(org.id, id);
    return { id, deleted: true };
  }

  @Put('/integrations/:id/group')
  async assignIntegrationGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { groupId?: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const groupId = body?.groupId || '';

    // Upstream `updateIntegrationGroup` only verifies the *integration* belongs
    // to the caller's org — it does not check the target customer/group side,
    // so a caller could otherwise connect an integration to another
    // organization's group by guessing/knowing its id. Verify it here before
    // reusing the upstream method.
    if (groupId) {
      const targetGroup = await this._integrationService.getCustomer(org.id, groupId);
      if (!targetGroup) {
        throw new HttpException({ msg: 'Group not found' }, 404);
      }
    }

    await this._integrationService.updateIntegrationGroup(org.id, id, groupId);
    return { id, groupId: groupId || null };
  }
}
