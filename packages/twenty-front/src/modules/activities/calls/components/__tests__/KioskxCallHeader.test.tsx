import { render, screen } from '@testing-library/react';
import { RecordShowCommandMenu } from '@/command-menu-item/components/RecordShowCommandMenu';

jest.mock('@/command-menu-item/contexts/CommandMenuContextProvider', () => ({
  CommandMenuContextProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock(
  '@/command-menu-item/display/components/PinnedCommandMenuItemButtons',
  () => ({
    PinnedCommandMenuItemButtons: () => <button>Send Email</button>,
  }),
);
jest.mock(
  '@/command-menu-item/edit/components/CommandMenuItemEditButton',
  () => ({
    CommandMenuItemEditButton: () => null,
  }),
);
jest.mock('@/context-store/constants/MainContextStoreInstanceId', () => ({
  MAIN_CONTEXT_STORE_INSTANCE_ID: 'main',
}));
jest.mock(
  '@/context-store/states/contextStoreCurrentObjectMetadataItemIdComponentState',
  () => ({ contextStoreCurrentObjectMetadataItemIdComponentState: 'metadata' }),
);
jest.mock(
  '@/context-store/states/contextStoreTargetedRecordsRuleComponentState',
  () => ({ contextStoreTargetedRecordsRuleComponentState: 'target' }),
);
jest.mock(
  '@/layout-customization/states/isLayoutCustomizationModeEnabledState',
  () => ({ isLayoutCustomizationModeEnabledState: 'layout' }),
);
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue',
  () => ({
    useAtomComponentStateValue: (state: string) =>
      state === 'metadata'
        ? 'person-metadata'
        : { mode: 'selection', selectedRecordIds: ['fake-person'] },
  }),
);
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => false,
}));
jest.mock('twenty-ui/utilities', () => ({ useIsMobile: () => false }));
jest.mock('@/activities/calls/components/KioskxPersonCall', () => ({
  KioskxPersonCall: ({ personId }: { personId: string }) => (
    <button data-person={personId}>Call</button>
  ),
}));

describe('record header wiring', () => {
  it('mounts the person Call action immediately after the Send Email actions', () => {
    render(
      <RecordShowCommandMenu
        objectNameSingular="person"
        objectRecordId="fake-person"
      />,
    );
    const email = screen.getByRole('button', { name: 'Send Email' });
    const call = screen.getByRole('button', { name: 'Call' });
    expect(email.nextElementSibling).toBe(call);
    expect(call.getAttribute('data-person')).toBe('fake-person');
  });
  it.each(['company', undefined])(
    'keeps existing header actions without Call for %s',
    (objectNameSingular) => {
      render(
        <RecordShowCommandMenu
          objectNameSingular={objectNameSingular}
          objectRecordId="fake-record"
        />,
      );
      expect(screen.getByRole('button', { name: 'Send Email' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
    },
  );
});
