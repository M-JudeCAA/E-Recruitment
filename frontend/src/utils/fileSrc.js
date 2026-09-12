import { API_URL } from '../models/apiClient';

// /api/files/:filename (fileController.js) requires the candidate's JWT -
// an <img> tag can't send an Authorization header, so this builds the
// same ?token= query-param URL the file-download links already use
// elsewhere (see VacancyDetail.jsx's staff equivalent), scoped to the
// candidate's own token.
export function candidateFileSrc(url) {
  if (!url) return null;
  const token = localStorage.getItem('candidateToken');
  return `${API_URL}${url}${token ? `?token=${token}` : ''}`;
}
