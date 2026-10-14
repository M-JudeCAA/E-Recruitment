// The departments a staff account belongs to: HR (the recruitment team) or
// ICT (who run the system). Set by a system administrator; an HR Manager
// manages the HR roles of the HR department's accounts only
// (staffUserController.updateHrTeamRole). Mirrored in
// frontend/src/utils/staffDepartments.js.

const STAFF_DEPARTMENTS = ['HR', 'ICT'];
const HR_DEPARTMENT = 'HR';

// The department as stored ("HR" or "ICT"), from any case; undefined when it
// is neither.
function parseStaffDepartment(value) {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return STAFF_DEPARTMENTS.find((d) => d === v);
}

const isHrDepartment = (value) => parseStaffDepartment(value) === HR_DEPARTMENT;

module.exports = { STAFF_DEPARTMENTS, HR_DEPARTMENT, parseStaffDepartment, isHrDepartment };
