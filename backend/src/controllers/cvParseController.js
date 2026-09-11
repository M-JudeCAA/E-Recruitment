const { extractText, UnsupportedCvFormatError } = require('../utils/cvParser');
const { extractFieldsFromText } = require('../utils/cvHeuristics');

// Parses an uploaded CV to suggest profile field values. Deliberately
// does not touch any model's create/update, write to disk, or reference
// fileUrl() - nothing about the uploaded file is persisted, per the
// "do not store this uploaded CV on save profile" requirement. Contrast
// with the separate, unrelated application-level CV upload in
// applicationDraftController.js, which is untouched and still persists.
async function parseCv(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const text = await extractText(req.file.buffer, req.file.mimetype);
    const fields = extractFieldsFromText(text);
    res.json(fields);
  } catch (err) {
    if (err instanceof UnsupportedCvFormatError) {
      return res.status(422).json({ error: err.message });
    }
    console.error('CV parse failed:', err);
    res.status(422).json({ error: 'Could not read this file - please try a different PDF or Word (.docx) document, or fill in your details manually.' });
  }
}

module.exports = { parseCv };
