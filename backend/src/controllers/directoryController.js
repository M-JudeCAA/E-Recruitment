const directory = require('../services/directoryService');

// GET /api/directory/people?q= - UCAA employees matching a name or email,
// from Microsoft Entra (for picking a vacancy's hiring manager). 501
// DIRECTORY_NOT_CONFIGURED until the directory permission is set up; the
// page then asks for the name and email instead.
async function searchPeople(req, res) {
  if (!directory.isConfigured()) {
    return res.status(501).json({ error: 'The staff directory is not connected yet - enter the name and UCAA email instead.', code: 'DIRECTORY_NOT_CONFIGURED' });
  }
  try {
    res.json(await directory.searchPeople(req.query.q));
  } catch (err) {
    console.error('Directory search failed:', err.message);
    res.status(502).json({ error: 'The staff directory could not be searched just now - enter the name and UCAA email instead.', code: 'DIRECTORY_UNAVAILABLE' });
  }
}

module.exports = { searchPeople };
