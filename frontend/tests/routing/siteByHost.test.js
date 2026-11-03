// @vitest-environment-options { "url": "https://erecruitment.caa.co.ug/staff/login" }
// Production: the site is chosen by host name (VITE_STAFF_HOST /
// VITE_INTERNAL_HOST), with no ports in the addresses at all.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { currentSite } from '../../src/site';
import { isStaffPort } from '../../src/staffPort';
import { isInternalPort } from '../../src/internalPort';

const at = (url) => window.history.replaceState(null, '', url);
// jsdom can't change the host with history; give location a stand-in.
function onHost(hostname, port = '') {
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, hostname, port });
}

beforeEach(() => {
  vi.stubEnv('VITE_STAFF_HOST', 'erecruitment.caa.co.ug');
  vi.stubEnv('VITE_INTERNAL_HOST', 'internal-careers.caa.co.ug');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('the HR workspace host is the staff site', () => {
  at('/staff/login');
  expect(currentSite()).toBe('staff');
  expect(isStaffPort()).toBe(true);
  expect(isInternalPort()).toBe(false);
});

test('the Internal Careers host is the internal site', () => {
  onHost('internal-careers.caa.co.ug');
  expect(currentSite()).toBe('internal');
  expect(isInternalPort()).toBe(true);
  expect(isStaffPort()).toBe(false);
});

test('the careers host, and any other name, is the public site', () => {
  onHost('careers.caa.co.ug');
  expect(currentSite()).toBe('public');
  onHost('www.caa.co.ug');
  expect(currentSite()).toBe('public');
});

test('host names are compared without regard to case', () => {
  onHost('ERecruitment.CAA.co.ug');
  expect(currentSite()).toBe('staff');
});

test('with host names set, the ports no longer decide', () => {
  onHost('careers.caa.co.ug', '4174');
  expect(currentSite()).toBe('public');
});

test('without host names, the port check works as on UAT', () => {
  vi.unstubAllEnvs();
  onHost('erecruitment-uat.caa.co.ug', '4174');
  expect(currentSite()).toBe('staff');
  onHost('erecruitment-uat.caa.co.ug', '4175');
  expect(currentSite()).toBe('internal');
  onHost('erecruitment-uat.caa.co.ug', '');
  expect(currentSite()).toBe('public');
});
