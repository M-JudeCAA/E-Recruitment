// @vitest-environment-options { "url": "http://recruit.caa.co.ug:4174/staff/login" }
import { STAFF_PORT, isStaffPort } from '../../src/staffPort';
import { INTERNAL_PORT, isInternalPort, internalSiteUrl, publicSiteUrl } from '../../src/internalPort';

// This file is served from the staff port (see the line above).
test('the staff site is the build served on port 4174', () => {
  expect(STAFF_PORT).toBe('4174');
  expect(isStaffPort()).toBe(true);
  expect(isInternalPort()).toBe(false);
});

test('links to the other sites use the same host, on their own ports', () => {
  expect(internalSiteUrl()).toBe(`http://recruit.caa.co.ug:${INTERNAL_PORT}`);
  // Away from a developer's machine the public site is on the default port.
  expect(publicSiteUrl()).toBe('http://recruit.caa.co.ug');
});
