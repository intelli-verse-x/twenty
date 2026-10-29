/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HiredDesk } from './HiredDesk';

const lead = {
  id: '11111111-1111-4111-a111-111111111111',
  label: 'Inquiry safe-label',
  inquiry: 'I want a cabinet.',
  canCall: false,
};
it('renders the safe inquiry without contacts, other CRM sections, or Call', async () => {
  const request = jest.fn(async () => ({ unavailable: false, leads: [lead] }));
  const { container } = render(
    <HiredDesk request={request} onSignOut={jest.fn()} />,
  );
  await screen.findByText('Inquiry safe-label');
  expect(screen.getByText('I want a cabinet.')).toBeInTheDocument();
  for (const hidden of [
    'Non-form person',
    'lead@example.test',
    '2025550123',
    'mailto:',
    'tel:',
    'Companies',
    'Opportunities',
    'People',
    'Workflows',
    'Notes',
  ])
    expect(container.innerHTML).not.toContain(hidden);
  expect(
    screen.queryByRole('button', { name: 'Call' }),
  ).not.toBeInTheDocument();
});
it('sends only opaque IDs for an enabled call, never a destination', async () => {
  const request = jest.fn(async (path) =>
    path === 'leads'
      ? { unavailable: false, leads: [{ ...lead, canCall: true }] }
      : { status: 'complete' },
  );
  render(<HiredDesk request={request} onSignOut={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Call' }));
  await screen.findByText('Call finished.');
  expect(request).toHaveBeenCalledWith('call', {
    leadId: lead.id,
    requestId: expect.any(String),
  });
  expect(JSON.stringify(request.mock.calls)).not.toContain('2025550123');
  expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
});
it.each(['rejected', 'unavailable'])(
  'shows no records when the query is %s',
  async (kind) => {
    const request = jest.fn(async () => {
      if (kind === 'rejected') throw new Error('private backend error');
      return { unavailable: true, leads: [lead] };
    });
    render(<HiredDesk request={request} onSignOut={jest.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Inquiries are unavailable',
      ),
    );
    expect(screen.queryByText(lead.label)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Call' }),
    ).not.toBeInTheDocument();
  },
);
