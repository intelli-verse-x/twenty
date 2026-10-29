/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HiredDesk } from './HiredDesk';

const lead = {
  id: '11111111-1111-4111-a111-111111111111',
  label: 'Inquiry safe-label',
  inquiry: 'I want a cabinet.',
  canCall: false,
  email: '••••@••••',
  phone: '••• ••• ••••',
};
it('renders contact cards with a disabled Call and no other CRM sections', async () => {
  const request = jest.fn(async () => ({ unavailable: false, leads: [lead] }));
  const { container } = render(
    <HiredDesk request={request} onSignOut={jest.fn()} />,
  );
  await screen.findByText('Inquiry safe-label');
  expect(screen.getByText('I want a cabinet.')).toBeInTheDocument();
  for (const hidden of [
    'Non-form person',
    'mailto:',
    'tel:',
    'Companies',
    'Opportunities',
    'People',
    'Workflows',
    'Notes',
  ])
    expect(container.innerHTML).not.toContain(hidden);
  expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Send email' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Email')).toBeInTheDocument();
  expect(screen.getByText('Phone')).toBeInTheDocument();
  expect(screen.getByText(lead.email)).toBeInTheDocument();
  expect(screen.getByText(lead.phone)).toBeInTheDocument();
});
it('sends only opaque IDs for an enabled call, never a destination', async () => {
  const request = jest.fn(async (path) =>
    path === 'leads'
      ? { unavailable: false, leads: [{ ...lead, canCall: true }] }
      : { status: 'complete' },
  );
  render(<HiredDesk request={request} onSignOut={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Call' }));
  await screen.findByText('Call finished · Transcript saved');
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
    expect(
      screen.getByRole('button', { name: 'Sign out' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(lead.label)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Call' }),
    ).not.toBeInTheDocument();
  },
);

it('keeps missing contact rows and separates pipe-delimited form lines', async () => {
  const request = jest.fn(async () => ({
    leads: [
      {
        ...lead,
        email: '',
        phone: '',
        inquiry: '|City / State: Austin, TX|Message: Hello|',
      },
    ],
  }));
  const { container } = render(
    <HiredDesk request={request} onSignOut={jest.fn()} />,
  );
  await screen.findByText('No email');
  expect(screen.getByText('No phone')).toBeInTheDocument();
  expect(screen.getByText('Email')).toBeInTheDocument();
  expect(screen.getByText('Phone')).toBeInTheDocument();
  expect(screen.getByText('City / State')).toBeInTheDocument();
  expect(screen.getByText('Austin, TX')).toBeInTheDocument();
  expect(screen.getByText('Hello')).toBeInTheDocument();
  expect(container.textContent).not.toContain('|');
  expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
});

it('composes in place, sends opaque ids and keeps the sent body on the card', async () => {
  const request = jest.fn(async (path) =>
    path === 'leads'
      ? { leads: [lead] }
      : {
          status: 'sent',
          message: {
            id: 'message',
            body: 'Thanks for your inquiry.',
            createdAt: '2026-10-29T10:00:00Z',
          },
        },
  );
  render(<HiredDesk request={request} onSignOut={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Thanks for your inquiry.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  await screen.findByText('Email sent');
  expect(
    screen.getByRole('region', { name: 'Email thread' }),
  ).toHaveTextContent('Thanks for your inquiry.');
  expect(request).toHaveBeenCalledWith('email', {
    leadId: lead.id,
    requestId: expect.any(String),
    body: 'Thanks for your inquiry.',
  });
});
it('keeps compose and an honest unavailable message when mail is off', async () => {
  const request = jest.fn(async (path) =>
    path === 'leads' ? { leads: [lead] } : { status: 'unavailable' },
  );
  render(<HiredDesk request={request} onSignOut={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Hello' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  await screen.findByText('Email is unavailable.');
  expect(screen.getByLabelText('Message')).toHaveValue('Hello');
  expect(
    screen.queryByRole('region', { name: 'Email thread' }),
  ).not.toBeInTheDocument();
});
it('does not replay an ambiguous email even after filtering the card away', async () => {
  const request = jest.fn(async (path) =>
    path === 'leads' ? { leads: [lead] } : { status: 'unknown' },
  );
  render(<HiredDesk request={request} onSignOut={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Hello' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  await screen.findByText(/Email status is unavailable/);
  fireEvent.change(screen.getByLabelText('Search inquiries'), {
    target: { value: 'no match' },
  });
  fireEvent.change(screen.getByLabelText('Search inquiries'), {
    target: { value: '' },
  });
  expect(
    screen.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  expect(request.mock.calls.filter(([path]) => path === 'email')).toHaveLength(
    1,
  );
});
