// The demo staff accounts prisma/seed.js creates for local development (all
// on the password ChangeMe123!) - the DHRA HR team, department 'HR' for each,
// plus an accounts-only system administrator. Shared with
// scripts/resetDemoData.js, which can remove exactly these before real users
// start testing.
const DEMO_STAFF = [
  { name: 'Alice HR', email: 'hro@caa.co.ug', role: 'HR_Officer', department: 'HR' },
  { name: 'Sam Senior', email: 'shro@caa.co.ug', role: 'Senior_HR_Officer', department: 'HR' },
  { name: 'Brian Principal', email: 'phro@caa.co.ug', role: 'Principal_HR_Officer', department: 'HR' },
  { name: 'Mary Manager', email: 'manager@caa.co.ug', role: 'Manager', department: 'HR' },
  { name: 'Carol Director', email: 'dhra@caa.co.ug', role: 'Director', department: 'HR' },
  { name: 'Ivan Admin', email: 'admin@caa.co.ug', role: null, isSystemAdmin: true, department: 'ICT' }
];

module.exports = { DEMO_STAFF };
