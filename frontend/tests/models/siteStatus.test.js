import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../src/models/apiClient', () => ({ default: { get: vi.fn() } }));
// eslint-disable-next-line import/first
import client from '../../src/models/apiClient';
// eslint-disable-next-line import/first
import { fetchExternalSiteOpen, resetSiteStatus, useExternalSiteOpen } from '../../src/models/siteStatus';

// Whether the public careers site is open to external applicants (App.jsx
// shows views/ExternalSiteClosed.jsx when it isn't).
beforeEach(() => {
  vi.clearAllMocks();
  resetSiteStatus();
});

test('closed only when the API says so', async () => {
  client.get.mockResolvedValue({ data: { externalSite: false } });
  expect(await fetchExternalSiteOpen()).toBe(false);
  expect(client.get).toHaveBeenCalledWith('/api/site-status');

  resetSiteStatus();
  client.get.mockResolvedValue({ data: { externalSite: true } });
  expect(await fetchExternalSiteOpen()).toBe(true);
});

test('open if the API cannot be reached (it still refuses what a closed site does not allow)', async () => {
  client.get.mockRejectedValue(new Error('Network Error'));
  expect(await fetchExternalSiteOpen()).toBe(true);
});

test('asked once per page load', async () => {
  client.get.mockResolvedValue({ data: { externalSite: false } });
  await fetchExternalSiteOpen();
  await fetchExternalSiteOpen();
  expect(client.get).toHaveBeenCalledTimes(1);
});

test('the hook is unknown until the answer arrives, and never asks off the public site', async () => {
  client.get.mockResolvedValue({ data: { externalSite: false } });
  const { result } = renderHook(() => useExternalSiteOpen(true));
  expect(result.current).toBeNull();
  await waitFor(() => expect(result.current).toBe(false));

  vi.clearAllMocks();
  resetSiteStatus();
  const other = renderHook(() => useExternalSiteOpen(false));
  expect(other.result.current).toBe(true);
  expect(client.get).not.toHaveBeenCalled();
});
