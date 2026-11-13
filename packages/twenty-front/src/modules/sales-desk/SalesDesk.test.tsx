/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SalesDesk, type SalesRow } from './SalesDesk';

jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    ariaLabel,
    variant: _variant,
    accent: _accent,
    ...props
  }: any) => (
    <button aria-label={ariaLabel} {...props}>
      {title}
    </button>
  ),
}));
jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
}));
const channels = { email: false, voice: false, voiceStatus: 'Calling is off.' };
const cleaning: SalesRow = {
  id: 'fixture-cleaning',
  label: 'Fixture Cleaning Applicant',
  company: 'Fixture Company',
  inquiry: 'Service: Office cleaning request',
  active: true,
};
const cars: SalesRow = {
  ...cleaning,
  id: 'fixture-cars',
  label: 'Fixture Rental Applicant',
  inquiry: 'Rental: Weekend car request',
};
const jobs: SalesRow = {
  id: 'fixture-job',
  label: 'Fixture Job Applicant',
  company: 'Fixture Employer',
  inquiry: 'Role: truck driver',
  hiringStatus: 'new',
};
const turo: SalesRow = {
  id: 'fixture-turo',
  label: 'Fixture Car',
  company: 'Turo fleet report',
  inquiry:
    'Idle gap: Fixture 2 days\nHost earn: Fixture USD 100\nMoney Turo has sent: Fixture USD 80',
};
let saved: SalesRow;
let failCars: boolean;
const request = jest.fn(async (path: string, body?: any) => {
  if (path.endsWith('/save')) {
    saved = { ...saved, ...body };
    return { row: saved };
  }
  if (path === 'queues/cars' && failCars) throw new Error('source down');
  return {
    rows:
      (
        {
          'queues/cleaning': [saved],
          'queues/cars': [cars],
          'queues/jobs': [jobs],
          'queues/turo': [turo],
        } as Record<string, SalesRow[]>
      )[path] ?? [],
  };
});
const mount = () =>
  render(
    <SalesDesk request={request} channels={channels} onSignOut={jest.fn()} />,
  );
beforeEach(() => {
  saved = { ...cleaning };
  failCars = false;
  request.mockClear();
});
it('shows four queues in order and the hired inquiry layout and actions', async () => {
  const { container } = mount();
  await screen.findByText('Office cleaning request');
  expect(
    screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label')),
  ).toEqual(['Cleaning', 'Cars', 'Jobs', 'Turo']);
  const card = within(screen.getByRole('article', { name: cleaning.label }));
  expect(card.getByText('Inquiry')).toBeInTheDocument();
  expect(card.getByText('Fixture Company')).toBeInTheDocument();
  expect(card.getByRole('button', { name: 'Send email' })).toBeVisible();
  expect(card.getByRole('button', { name: 'Call' })).toBeVisible();
  expect(container.querySelector('.hired-avatar')).toHaveTextContent('F');
});
it.each([
  ['', '', 'Next step and Due time required.'],
  ['', '2026-12-01T10:00', 'Next step required.'],
  ['Confirm scope', '', 'Due time required.'],
])(
  'keeps the cleaning card when required fields are missing',
  async (step, due, message) => {
    mount();
    const card = within(
      await screen.findByRole('article', { name: cleaning.label }),
    );
    fireEvent.change(card.getByLabelText('Next step'), {
      target: { value: step },
    });
    fireEvent.change(card.getByLabelText('Due time'), {
      target: { value: due },
    });
    fireEvent.click(card.getByRole('button', { name: 'Save' }));
    expect(card.getByText(message)).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Cleaning' })).getByText(
        cleaning.label,
      ),
    ).toBeVisible();
    expect(request.mock.calls.some(([path]) => path.endsWith('/save'))).toBe(
      false,
    );
  },
);
it('saves next step and due time on the card, including after reload', async () => {
  const view = mount();
  const card = within(
    await screen.findByRole('article', { name: cleaning.label }),
  );
  fireEvent.change(card.getByLabelText('Next step'), {
    target: { value: 'Confirm scope' },
  });
  fireEvent.change(card.getByLabelText('Due time'), {
    target: { value: '2026-12-01T10:00' },
  });
  fireEvent.click(card.getByRole('button', { name: 'Save' }));
  await card.findByText('Saved.');
  expect(card.getByText('Confirm scope')).toBeVisible();
  view.unmount();
  mount();
  expect(await screen.findByText('Confirm scope')).toBeVisible();
  expect(
    screen.getByLabelText('Due time', { selector: '#due-fixture-cleaning' }),
  ).toHaveValue('2026-12-01T10:00');
});
it('shows hiring status without a sales stage or deal value; cars are not reservations', async () => {
  mount();
  const card = within(await screen.findByRole('article', { name: jobs.label }));
  expect(card.getByLabelText('Hiring status')).toHaveValue('new');
  expect(
    card.queryByText(/sales stage|deal value|mark won/i),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByText('This request does not reserve a car.'),
  ).toBeVisible();
});
it('shows the fleet report without Call, sales stage, or mark won', async () => {
  mount();
  const card = within(await screen.findByRole('article', { name: turo.label }));
  expect(card.getByText('Report')).toBeVisible();
  expect(card.getByText('Host earn')).toBeVisible();
  expect(card.getByText('Money Turo has sent')).toBeVisible();
  expect(card.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
  expect(card.queryByText(/sales stage|mark won/i)).not.toBeInTheDocument();
});
it('keeps off-channel buttons and the same compose box without sending', async () => {
  mount();
  const card = within(
    await screen.findByRole('article', { name: cleaning.label }),
  );
  expect(card.getByText('Email is unavailable.')).toBeVisible();
  expect(card.getByText('Calling is off.')).toBeVisible();
  expect(card.getByRole('button', { name: 'Call' })).toBeDisabled();
  fireEvent.click(card.getByRole('button', { name: 'Send email' }));
  fireEvent.change(card.getByLabelText('Message'), {
    target: { value: 'Fixture draft only' },
  });
  fireEvent.click(card.getByRole('button', { name: 'Send', exact: true }));
  expect(request.mock.calls.some(([path]) => path.endsWith('/email'))).toBe(
    false,
  );
});
it('keeps previous Cars rows and Cleaning when a refresh fails', async () => {
  mount();
  await screen.findByText(cars.label);
  failCars = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Cars' }));
  await screen.findByText('Cars could not refresh. Try again.');
  expect(screen.getByText(cars.label)).toBeVisible();
  expect(screen.getByText(cleaning.label)).toBeVisible();
});
it('gives a never-loaded queue a sentence while other queues work', async () => {
  failCars = true;
  mount();
  await screen.findByText(cleaning.label);
  const queue = within(screen.getByRole('region', { name: 'Cars' }));
  expect(
    await queue.findByText('Cars could not refresh. Try again.'),
  ).toBeVisible();
  expect(
    queue.getByText('No requests have loaded for this queue.'),
  ).toBeVisible();
});
