import staffClient from '../models/staffApiClient';

// Approves a vacancy. One created on a job description that isn't approved
// (FR-ATS-018) is refused with JD_EXCEPTION_NOT_AUTHORISED until the
// approver confirms they authorise that exception - asked here with the
// themed confirm dialog, then sent again with authoriseJdException.
// Resolves to the response, or null if the approver declined.
export async function approveVacancy(id, confirm) {
  try {
    return await staffClient.patch(`/api/vacancies/${id}/approve`);
  } catch (err) {
    if (err.response?.data?.code !== 'JD_EXCEPTION_NOT_AUTHORISED') throw err;
    const ok = await confirm(err.response.data.error, {
      title: 'Authorise job description exception', confirmLabel: 'Authorise and approve'
    });
    if (!ok) return null;
    return staffClient.patch(`/api/vacancies/${id}/approve`, { authoriseJdException: true });
  }
}
