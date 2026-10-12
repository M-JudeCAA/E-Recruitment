import { isStaffPort } from '../../src/staffPort';
import { INTERNAL_PORT, isInternalPort, publicSiteUrl } from '../../src/internalPort';

// The default test page is the public site on a developer's machine,
// http://localhost:5173 (vitest.config.js).
test('the public site is neither the staff site nor Internal Careers', () => {
  expect(isStaffPort()).toBe(false);
  expect(isInternalPort()).toBe(false);
  expect(INTERNAL_PORT).toBe('4175');
});

test('locally the public site is on the dev server\'s port', () => {
  expect(publicSiteUrl()).toBe('http://localhost:5173');
});
