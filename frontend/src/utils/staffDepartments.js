// The departments a staff account belongs to - mirrors
// backend/src/utils/staffDepartments.js. A system administrator sets it; an
// HR Manager manages the HR roles of the HR department's accounts.
export const STAFF_DEPARTMENTS = ['HR', 'ICT'];
export const HR_DEPARTMENT = 'HR';

export const isHrDepartment = (value) => String(value || '').trim().toUpperCase() === HR_DEPARTMENT;
