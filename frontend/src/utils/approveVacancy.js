import staffClient from '../models/staffApiClient';

// Approves a vacancy. An exception the approver must authorise explicitly is
// refused until they confirm it - asked here with the themed confirm dialog,
// then sent again with the matching flag:
//   JD_EXCEPTION_NOT_AUTHORISED        a job description that isn't approved (FR-ATS-018)
//   HEADCOUNT_EXCEPTION_NOT_AUTHORISED more posts than the approved headcount (FR-ATS-006, Directors only)
// Resolves to the response, or null if the approver declined.
// Takes the vacancy as the approver saw it: its updatedAt goes along, so one
// edited since they looked is refused (409 VACANCY_CHANGED), not approved.
const EXCEPTIONS = {
  JD_EXCEPTION_NOT_AUTHORISED: { flag: 'authoriseJdException', title: 'Authorise job description exception' },
  HEADCOUNT_EXCEPTION_NOT_AUTHORISED: { flag: 'authoriseHeadcountException', title: 'Authorise going above the approved headcount' }
};

export async function approveVacancy(vacancy, confirm) {
  const { id } = vacancy;
  const body = vacancy.updatedAt ? { expectedUpdatedAt: vacancy.updatedAt } : {};
  for (;;) {
    try {
      return await staffClient.patch(`/api/vacancies/${id}/approve`, body);
    } catch (err) {
      const exception = EXCEPTIONS[err.response?.data?.code];
      if (!exception || body[exception.flag]) throw err;
      const ok = await confirm(err.response.data.error, { title: exception.title, confirmLabel: 'Authorise and approve' });
      if (!ok) return null;
      body[exception.flag] = true;
    }
  }
}
