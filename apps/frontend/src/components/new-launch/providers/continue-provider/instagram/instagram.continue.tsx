'use client';

import { withContinueProvider } from '../with-continue-provider';

interface InstagramItem {
  id: string;
  pageId: string;
  username: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

interface InstagramSelection {
  id: string;
  pageId: string;
}

export const InstagramContinue = withContinueProvider<
  InstagramItem,
  InstagramSelection
>({
  endpoint: 'pages',
  swrKey: 'load-instagram-pages',
  titleKey: 'select_instagram_account',
  titleDefault: 'Select Instagram Account:',
  guidanceMessages: [
    {
      key: 'designerpro_instagram_account_visibility',
      text: 'Only professional Instagram accounts (Business or Creator) linked to a Facebook Page assigned to the profile used for this login appear here.',
    },
    {
      key: 'designerpro_instagram_link_steps',
      text: 'Missing an account? Link Instagram to its Facebook Page in Meta Business Suite and confirm that your Facebook profile has content access or full control over that Page. Then restart this connection.',
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
      key: 'designerpro_open_meta_instagram_accounts',
      text: 'Open Instagram accounts in Meta',
      href: 'https://business.facebook.com/latest/settings/instagram_accounts',
    },
  ],
  emptyStateMessages: [
    {
      key: 'designerpro_no_eligible_instagram_accounts',
      text: 'No eligible professional Instagram account was found for this profile.',
    },
    {
      key: 'designerpro_fix_meta_access_and_restart',
      text: 'Correct the access in Meta, close this window, and start the connection again.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id, pageId: item.pageId }),
  transformSaveData: (selection) => selection,
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => (
    <>
      <div>
        <img
          className="w-full max-w-[156px]"
          src={item.picture.data.url}
          alt="profile"
        />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
