// Directorates and departments now carry a short code (DANS, ARFFS, ...)
// and a full name, and `name` is the full name. Rows from before codes
// whose full name HR hasn't filled in yet still have the short name as
// their name - this spells those out for applicants on the careers sites.
// Anything else is shown as stored.

export const DIRECTORATE_NAMES = {
  DANS: 'Air Navigation Services',
  DAAS: 'Airports and Aviation Security',
  DSSER: 'Safety, Security and Economic Regulation',
  DF: 'Finance',
  DHRA: 'Human Resource and Administration'
};

export const DEPARTMENT_NAMES = {
  ACCOUNTS: 'Accounts',
  ADMIN: 'Administration',
  AIM: 'Aeronautical Information Management',
  ARFFS: 'Aerodrome Rescue and Fire Fighting Services',
  ATM: 'Air Traffic Management',
  AUDIT: 'Internal Audit',
  AVSEC: 'Aviation Security',
  ER: 'Economic Regulation',
  FINANCE: 'Finance',
  FSS: 'Flight Safety Standards',
  HR: 'Human Resource',
  IT: 'Information Technology',
  'MGT ACCT': 'Management Accounting',
  OPS: 'Operations',
  PDU: 'Procurement and Disposal'
};

const key = (name) => String(name || '').trim().toUpperCase();

export const directorateName = (name) => DIRECTORATE_NAMES[key(name)] || name || '';
export const departmentName = (name) => DEPARTMENT_NAMES[key(name)] || name || '';

/** "Air Traffic Management · Air Navigation Services" for a vacancy's department (with its directorate). */
export function orgLabel(department, separator = ' · ') {
  if (!department) return '';
  const dept = departmentName(department.name);
  const dir = department.directorate?.name ? directorateName(department.directorate.name) : '';
  return dir && dir !== dept ? `${dept}${separator}${dir}` : dept;
}
