// Appends the staff JWT as a ?token= query param - the authenticated
// /api/files/:filename route accepts it there since a plain <a href>
// download can't set an Authorization header (see CLAUDE.md's File access
// section). Shared by ApplicationReviewCard and anywhere else that links
// directly to a candidate's uploaded file.
export function fileLink(url) {
  if (!url) return null;
  const token = localStorage.getItem('staffToken');
  return `${url}?token=${token}`;
}
