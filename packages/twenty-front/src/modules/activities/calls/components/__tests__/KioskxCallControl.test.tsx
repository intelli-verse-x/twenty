import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KioskxCallControl } from '../KioskxCallControl';

jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    onClick,
    disabled,
  }: {
    title: string;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {title}
    </button>
  ),
}));
jest.mock('twenty-ui/display', () => ({ IconPhone: () => null }));

const on = { available: true, status: '', message: '' };
const host = 'kioskx.crm.intelli-verse-x.ai';
describe('person header Call control', () => {
  it('renders Call beside the existing email control without a phone link or form', () => {
    const { container } = render(
      <>
        <button>Send Email</button>
        <KioskxCallControl hostname={host} state={on} onCall={jest.fn()} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Call' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send Email' })).toBeTruthy();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a, input, form')).toBeNull();
  });
  it.each(['env off', 'no phone'])('keeps email and omits Call for %s', () => {
    render(
      <>
        <button>Send Email</button>
        <KioskxCallControl
          hostname={host}
          state={{ ...on, available: false }}
          onCall={jest.fn()}
        />
      </>,
    );
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send Email' })).toBeTruthy();
  });
  it.each([
    'ivx.crm.intelli-verse-x.ai',
    'crm.intelli-verse-x.ai',
    'other.example',
  ])('omits Call on %s even if server availability is true', (hostname) => {
    render(
      <KioskxCallControl hostname={hostname} state={on} onCall={jest.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
  });
  it('omits Call while server availability is unknown', () => {
    render(<KioskxCallControl hostname={host} onCall={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
  });
  it('calls the voice mutation and shows a short failure on the record', async () => {
    const onCall = jest
      .fn()
      .mockRejectedValue(new Error('private upstream error'));
    render(<KioskxCallControl hostname={host} state={on} onCall={onCall} />);
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Call could not be confirmed',
      ),
    );
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).not.toContain('private');
  });
  it('shows missing transcript failure without pretending completion', () => {
    render(
      <KioskxCallControl
        hostname={host}
        state={{
          ...on,
          status: 'failed',
          message: 'No transcript returned. Check Voice Studio.',
        }}
        onCall={jest.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'No transcript returned',
    );
  });
});
