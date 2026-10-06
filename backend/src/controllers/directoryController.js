const directory = require('../services/directoryService');
const candidateModel = require('../models/candidateModel');

// GET /api/directory/people?q= - UCAA employees matching a name or email,
// from Microsoft Entra (for picking a vacancy's hiring manager, or an internal
// candidate's supervisor). 501
// DIRECTORY_NOT_CONFIGURED until the directory permission is set up; the
// page then asks for the name and email instead.
async function searchPeople(req, res) {
  return search(req, res, () => true);
}

// GET /api/candidates/me/directory/people?q= - the same search for an internal
// candidate picking their supervisor on Internal Careers (the browser tries
// Graph with their own Microsoft session first). Themselves left out.
async function searchColleagues(req, res) {
  if (req.user.candidateType !== 'Internal') {
    return res.status(403).json({ error: 'Only UCAA employees can search the staff directory' });
  }
  const me = await candidateModel.findById(req.user.id);
  const own = String(me?.email || '').toLowerCase();
  return search(req, res, (p) => !own || p.email !== own);
}

async function search(req, res, keep) {
  if (!directory.isConfigured()) {
    return res.status(501).json({ error: 'The staff directory is not connected yet - enter the name and UCAA email instead.', code: 'DIRECTORY_NOT_CONFIGURED' });
  }
  try {
    res.json((await directory.searchPeople(req.query.q)).filter(keep));
  } catch (err) {
    console.error('Directory search failed:', err.message);
    res.status(502).json({ error: 'The staff directory could not be searched just now - enter the name and UCAA email instead.', code: 'DIRECTORY_UNAVAILABLE' });
  }
}

module.exports = { searchPeople, searchColleagues };
