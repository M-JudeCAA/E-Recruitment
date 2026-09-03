const positionModel = require('../models/positionModel');
const departmentModel = require('../models/departmentModel');

// Positions are operational, not structural, the way Directorates and
// Departments are - new job titles get added far more often than new
// departments do. No approval workflow here, unlike Department; any
// HR Officer can add one directly. Flagged as a design choice worth
// revisiting if UCAA wants tighter control over position creation.
async function create(req, res) {
  const { name, departmentId, level } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Position name is required' });
  }
  const department = await departmentModel.findById(Number(departmentId));
  if (!department || department.status !== 'Approved') {
    return res.status(400).json({ error: 'Select a valid, approved department' });
  }
  if (!Number.isInteger(Number(level))) {
    return res.status(400).json({ error: 'Level must be a whole number' });
  }

  let position;
  try {
    position = await positionModel.create({
      name: name.trim(), departmentId: department.id, level: Number(level), createdById: req.user.id
    });
  } catch (err) {
    return res.status(409).json({ error: 'This position already exists in that department' });
  }
  res.status(201).json(position);
}

async function listForDropdown(req, res) {
  const positions = await positionModel.findAllForDropdown();
  res.json(positions);
}

// Called after a Title/Position is selected on the vacancy form, to
// populate the Reports To dropdown with only genuinely senior positions
// in that exact department record.
async function listSeniorOptions(req, res) {
  const position = await positionModel.findById(Number(req.params.id));
  if (!position) return res.status(404).json({ error: 'Position not found' });

  const seniorPositions = await positionModel.findSeniorInDepartment(position.departmentId, position.level);
  res.json(seniorPositions);
}

// Populates the Position dropdown only after a Department has been
// chosen, scoped to just that department.
async function listByDepartment(req, res) {
  const departmentId = Number(req.params.id);
  const positions = await positionModel.findByDepartment(departmentId);
  res.json(positions);
}

module.exports = { create, listForDropdown, listSeniorOptions, listByDepartment };
