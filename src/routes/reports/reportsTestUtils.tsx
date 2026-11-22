import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';
import { createLocalStore } from '../../progress/localStore';
import { Mem } from '../../test/appHarness';
import type { ReportsApi } from '../../reports/ReportsContext';

/** Fictional filler, long enough to pass the 200 character minimum. */
export const FILL = 'The trainee noted that the client spoke slowly and paused often before answering. '.repeat(4);
export const CLEAN = FILL + 'We agreed to look at one small step this week.';

export function renderReports(url: string, opts: { enabled?: boolean; api?: Partial<ReportsApi> } = {}) {
  const storage = new Mem();
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App store={createLocalStore(storage)} storage={storage} reportsEnabled={opts.enabled} reportsApi={opts.api} />
    </MemoryRouter>,
  );
}
