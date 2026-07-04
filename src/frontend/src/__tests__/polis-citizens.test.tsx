/** Населення — gallery renders reputation, dossier opens with real record. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CitizensGallery } from '../components/polis/room/CitizensGallery';
import { usePolisStore } from '../stores/polisStore';

vi.mock('../services/polisApi', () => ({
  polisApi: {
    citizens: vi.fn().mockResolvedValue({
      citizens: [
        {
          role: 'senior_architect', name: 'senior architect', successes: 9,
          failures: 1, revisions: 2, reliability: 0.91, tier: 'майстер',
          tokens_produced: 42000, top_domain: 'dev',
          domains: { dev: 8, generic: 2 }, last_active: 0,
          recent_titles: ['Архітектура ядра', 'Розбивка модулів'],
          department: 'engineering', description: 'проєктує системи',
          personality: '',
        },
        {
          role: 'pen_tester', name: 'pen tester', successes: 1, failures: 3,
          revisions: 4, reliability: 0.2, tier: 'нестабільний',
          tokens_produced: 800, top_domain: 'dev', domains: { dev: 4 },
          last_active: 0, recent_titles: [],
        },
      ],
    }),
  },
}));

beforeEach(() => {
  usePolisStore.setState({ citizens: [] } as never);
});

describe('CitizensGallery', () => {
  it('renders citizens ranked with tier + record', async () => {
    render(<CitizensGallery />);
    expect(await screen.findByTestId('citizen-senior_architect')).toBeTruthy();
    expect(screen.getByText('майстер')).toBeTruthy();
    expect(screen.getByText(/9✓/)).toBeTruthy();
  });

  it('opens a dossier with mastered domains and recent deeds', async () => {
    render(<CitizensGallery />);
    fireEvent.click(await screen.findByTestId('citizen-senior_architect'));
    await waitFor(() => expect(screen.getByTestId('citizen-dossier')).toBeTruthy());
    expect(screen.getByText('проєктує системи')).toBeTruthy();
    expect(screen.getByText(/Архітектура ядра/)).toBeTruthy();
    expect(screen.getByText('dev ×8')).toBeTruthy();
  });

  it('marks a live-working citizen from the store', async () => {
    usePolisStore.setState({
      citizens: [
        {
          id: 'senior_architect', name: 'senior architect', role: 'senior_architect',
          district: 'dev', activity: 'working', missions_done: 9,
        },
      ],
    } as never);
    render(<CitizensGallery />);
    await screen.findByTestId('citizen-senior_architect');
    expect(screen.getByText(/працює/)).toBeTruthy();
  });
});
