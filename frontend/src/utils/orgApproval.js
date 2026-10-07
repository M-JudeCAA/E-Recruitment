import staffClient from '../models/staffApiClient';

// Approving organisation changes (backend services/orgApprovalService.js):
// directorates, departments and positions one by one, or everything a
// spreadsheet import left pending together. Principal HR Officer+, never
// the person who added it.

const BASE = { directorate: '/api/directorates', department: '/api/departments', position: '/api/positions' };
export const ORG_WORD = { directorate: 'Directorate', department: 'Department', position: 'Position', import: 'Import' };

export const approveOrg = (entity, id) => (entity === 'import'
  ? staffClient.patch(`/api/departments/imports/${id}/approve`)
  : staffClient.patch(`${BASE[entity]}/${id}/approve`));

export const rejectOrg = (entity, id, reason) => staffClient.patch(`${BASE[entity]}/${id}/reject`, { reason });
