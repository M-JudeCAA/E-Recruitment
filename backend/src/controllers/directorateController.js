const directorateModel = require('../models/directorateModel');

// Directorates are foundational and rarely change, unlike Departments -
// so they don't go through the propose/approve workflow. Restricted to
// Principal HR Officer and above.
async function create(req, res) {
  const { name, directorName, directorEmail } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Directorate name is required' });
  }

  const existing = await directorateModel.findByName(name.trim());
  if (existing) {
    return res.status(409).json({ error: 'A directorate with this name already exists' });
  }

  const directorate = await directorateModel.create({
    name: name.trim(), directorName, directorEmail, createdById: req.user.id
  });
  res.status(201).json(directorate);
}

// Any authenticated staff member can list directorates - needed to
// populate the dropdown when proposing a new department.
async function list(req, res) {
  const directorates = await directorateModel.findAll();
  res.json(directorates);
}

module.exports = { create, list };
