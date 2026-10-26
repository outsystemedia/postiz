'use client';

import { FC, ReactNode, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';

const SWR_OPTIONS = {
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: false,
  revalidateIfStale: false,
  revalidateOnMount: true,
  revalidateOnReconnect: false,
  refreshInterval: 0,
};

export interface ContinueProviderProps {
  onSave: (data: any) => Promise<void>;
  existingId: string[];
  initialData?: any[];
  isSaving?: boolean;
}

export interface EmptyStateMessage {
  key: string;
  text: string;
}

export interface GuidanceLink extends EmptyStateMessage {
  href: string;
}

export interface ContinueProviderConfig<TItem, TSelection> {
  endpoint: string;
  swrKey: string;
  titleKey: string;
  titleDefault: string;
  emptyStateMessages: EmptyStateMessage[];
  guidanceMessages?: EmptyStateMessage[];
  guidanceLinks?: GuidanceLink[];
  getSelectionValue: (item: TItem) => TSelection;
  transformSaveData: (selection: TSelection) => any;
  renderItem: (item: TItem, isSelected: boolean) => ReactNode;
  isSelected: (item: TItem, selection: TSelection | null) => boolean;
  getItemId: (item: TItem) => string;
}

export function withContinueProvider<TItem, TSelection>(
  config: ContinueProviderConfig<TItem, TSelection>
): FC<ContinueProviderProps> {
  const {
    endpoint,
    swrKey,
    titleKey,
    titleDefault,
    emptyStateMessages,
    guidanceMessages,
    guidanceLinks,
    getSelectionValue,
    transformSaveData,
    renderItem,
    isSelected,
    getItemId,
  } = config;

  return function ContinueProviderComponent(props: ContinueProviderProps) {
    const { onSave, existingId, initialData, isSaving } = props;
    const call = useCustomProviderFunction();
    const t = useT();
    const [selection, setSelection] = useState<TSelection | null>(null);

    const loadData = useCallback(async () => {
      // Skip fetch if initial data was provided
      if (initialData) {
        return initialData;
      }
      try {
        return await call.get(endpoint);
      } catch (e) {
        // Handle error silently
      }
    }, [initialData]);

    const { data, isLoading } = useSWR(
      initialData ? null : swrKey,
      loadData,
      SWR_OPTIONS
    );

    const resolvedData = initialData || data;

    const handleSelect = useCallback(
      (item: TItem) => () => {
        setSelection(getSelectionValue(item));
      },
      []
    );

    const handleSave = useCallback(async () => {
      if (selection) {
        await onSave(transformSaveData(selection));
      }
    }, [onSave, selection]);

    const filteredData = useMemo(() => {
      return (
        (resolvedData as TItem[])?.filter(
          (item) => !existingId.includes(getItemId(item))
        ) || []
      );
    }, [resolvedData, existingId]);

    const guidance = guidanceMessages?.length ? (
      <div className="rounded-[10px] border border-[#473d22] bg-[#282313] px-[14px] py-[12px] text-[13px] leading-[20px] text-[#f2d88b]">
        <div className="space-y-[8px]">
          {guidanceMessages.map((message) => (
            <p key={message.key}>{t(message.key, message.text)}</p>
          ))}
        </div>
        {!!guidanceLinks?.length && (
          <div className="mt-[12px] flex flex-wrap gap-[8px]">
            {guidanceLinks.map((link) => (
              <a
                key={link.key}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-[7px] border border-[#766426] bg-[#362f19] px-[10px] py-[6px] font-medium text-[#ffe59a] hover:bg-[#443a1c]"
              >
                {t(link.key, link.text)} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    ) : null;

    if (!isLoading && !resolvedData?.length) {
      return (
        <div className="flex flex-col gap-[20px]">
          {guidance}
          <div className="text-center flex flex-col justify-center items-center text-[16px] leading-[24px] min-h-[180px]">
            {emptyStateMessages.map((msg, index) => (
              <span key={msg.key}>
                {t(msg.key, msg.text)}
                {index < emptyStateMessages.length - 1 && (
                  <>
                    <br />
                    <br />
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-[20px]">
        {guidance}
        <div>{t(titleKey, titleDefault)}</div>
        <div className="grid grid-cols-3 justify-items-center select-none cursor-pointer gap-[10px]">
          {filteredData.map((item) => (
            <div
              key={getItemId(item)}
              className={clsx(
                'flex flex-col w-full text-center gap-[10px] border border-input p-[10px] hover:bg-seventh rounded-[8px]',
                isSelected(item, selection) && 'bg-seventh border-primary'
              )}
              onClick={handleSelect(item)}
            >
              {renderItem(item, isSelected(item, selection))}
            </div>
          ))}
        </div>
        <div>
          <Button
            disabled={!selection || isSaving}
            loading={isSaving}
            onClick={handleSave}
          >
            {t('save', 'Save')}
          </Button>
        </div>
      </div>
    );
  };
}
