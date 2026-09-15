import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, renderHook } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { Provider as JotaiProvider } from 'jotai';

import { useHandleResetPassword } from '@/auth/sign-in-up/hooks/useHandleResetPassword';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar');

dynamicActivate(SOURCE_LOCALE);

const renderHooks = () => {
  const { result } = renderHook(() => useHandleResetPassword(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        JotaiProvider,
        { store: jotaiStore },
        createElement(I18nProvider, { i18n }, children),
      ),
  });
  return { result };
};

describe('useHandleResetPassword', () => {
  const enqueueErrorSnackBarMock = jest.fn();
  const assignMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useSnackBar as jest.Mock).mockReturnValue({
      enqueueErrorSnackBar: enqueueErrorSnackBarMock,
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignMock },
    });
  });

  it('should show error message if email is invalid', async () => {
    const { result } = renderHooks();
    await act(() => result.current.handleResetPassword('')());

    expect(enqueueErrorSnackBarMock).toHaveBeenCalledWith({
      message: 'Invalid email',
    });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('should open the Intelli Verse X CRM OTP reset page', async () => {
    const { result } = renderHooks();
    await act(() => result.current.handleResetPassword('test@example.com')());

    expect(assignMock).toHaveBeenCalledWith(
      'https://admin.intelli-verse-x.ai/tool-reset-password?tool=crm&email=test%40example.com',
    );
  });
});
