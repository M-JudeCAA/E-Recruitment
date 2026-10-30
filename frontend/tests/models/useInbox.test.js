vi.mock('../../src/models/staffApiClient', () => ({ default: { get: vi.fn() } }));
// eslint-disable-next-line import/first
import staffClient from '../../src/models/staffApiClient';
// eslint-disable-next-line import/first
import { refreshInbox, clearInbox } from '../../src/models/useInbox';

describe('refreshInbox', () => {
  beforeEach(() => { localStorage.setItem('staffToken', 't'); clearInbox(); });

  test("an older answer arriving after a newer one doesn't put back stale counts", async () => {
    let answerFirst;
    staffClient.get
      .mockReturnValueOnce(new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce({ data: { items: [] } });

    const first = refreshInbox(); // the page's slow first load
    const second = await refreshInbox(); // after the action
    answerFirst({ data: { items: [{ key: 'employment-checks', count: 1 }] } });

    expect(second).toEqual({ items: [] });
    expect(await first).toEqual({ items: [] });
  });
});
