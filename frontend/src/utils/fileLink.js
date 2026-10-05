import { API_URL } from '../models/apiClient';

// Appends the staff JWT as a ?token= query param - the authenticated
// /api/files/:filename route accepts it there since a plain <a href>
// download can't set an Authorization header (see CLAUDE.md's File access
// section). Shared by ApplicationReviewCard and anywhere else that links
// directly to a candidate's uploaded file.
export function fileLink(url) {
  if (!url) return null;
  const token = localStorage.getItem('staffToken');
  // The API's own origin - the SPA is served from another one, so a bare
  // /api/files path would hit the SPA's server instead (same as
  // fileSrc.js's candidate equivalent).
  return `${API_URL}${url}?token=${token}`;
}
