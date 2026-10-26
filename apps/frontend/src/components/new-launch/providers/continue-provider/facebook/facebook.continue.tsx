'use client';

import { withContinueProvider } from '../with-continue-provider';

interface FacebookItem {
  id: string;
  username: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

export const FacebookContinue = withContinueProvider<FacebookItem, string>({
  endpoint: 'pages',
  swrKey: 'load-facebook-pages',
  titleKey: 'select_page',
  titleDefault: 'Select Page:',
  guidanceMessages: [
    {
      key: 'designerpro_facebook_page_visibility',
      text: 'Only Pages assigned to the Facebook profile used for this login, with permission to create content or full control, appear here.',
    },
    {
      key: 'designerpro_meta_page_access_steps',
      text: 'Missing a Page? In Meta Business Suite, go to Settings → Users → People → your profile → Assigned assets → Page. Enable content creation or full control, then restart this connection.',
    },
    {
      key: 'designerpro_meta_no_business_selection',
      text: 'DesignerPRO does not choose a Business Portfolio. Meta returns the assets available to this Facebook profile.',
    },
  ],
  guidanceLinks: [
    {
      key: 'designerpro_open_meta_assigned_assets',
      text: 'Open People and assigned assets in Meta',
      href: 'https://business.facebook.com/latest/settings/business_users',
    },
    {
      key: 'designerpro_open_meta_pages',
      text: 'Open Facebook Pages in Meta',
      href: 'https://business.facebook.com/latest/settings/pages',
    },
  ],
  emptyStateMessages: [
    {
      key: 'designerpro_no_eligible_facebook_pages',
      text: 'No eligible Facebook Page was found for this profile.',
    },
    {
      key: 'designerpro_fix_meta_access_and_restart',
      text: 'Correct the access in Meta, close this window, and start the connection again.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => item.id,
  transformSaveData: (selection) => ({ page: selection }),
  isSelected: (item, selection) => selection === item.id,
  renderItem: (item) => (
    <>
      <div>
        <img className="w-full" src={item.picture.data.url} alt="profile" />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
