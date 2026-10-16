// One-off: cases names and titles already stored the way new ones now are
// (utils/textCase.js) - only values typed all in capitals or all in lower
// case; anything in mixed case is left exactly as it is.
//
//   node scripts/applyTextCase.js          what it would change (nothing is written)
//   node scripts/applyTextCase.js --yes    apply it
//
// Never touched: anything someone wrote (letters, answers, advert and
// requisition wording), erased candidates, emails and codes (already
// normalised when saved).
require('dotenv').config();
const prisma = require('../src/config/db');
const { formatAs } = require('../src/utils/textCase');

// model -> { field: kind }, plus an optional filter.
const TARGETS = [
  { model: 'candidate', label: 'Candidate', fields: { fullName: 'name', location: 'title', districtOfOrigin: 'title' }, where: { purgedAt: null } },
  { model: 'education', label: 'Education', fields: { institution: 'title', fieldOfStudy: 'title' } },
  { model: 'workExperience', label: 'Work experience', fields: { employer: 'title', jobTitle: 'title' } },
  { model: 'certificate', label: 'Certificate', fields: { name: 'title', issuingOrganization: 'title' } },
  { model: 'staffUser', label: 'Staff account', fields: { name: 'name' } },
  { model: 'directorate', label: 'Directorate', fields: { name: 'title', directorName: 'name' } },
  { model: 'department', label: 'Department', fields: { name: 'title' } },
  { model: 'position', label: 'Position', fields: { name: 'title' } },
  // The vacancy's title is its position's name when it was raised.
  { model: 'vacancy', label: 'Vacancy', fields: { title: 'title', hiringManagerName: 'name' } },
  { model: 'panelMember', label: 'Interview panelist', fields: { name: 'name', trade: 'title' } },
  { model: 'shortlistMember', label: 'Committee member', fields: { name: 'name' } }
];

async function run({ apply = false } = {}) {
  let total = 0;
  for (const { model, label, fields, where } of TARGETS) {
    const select = Object.fromEntries([['id', true], ...Object.keys(fields).map((f) => [f, true])]);
    const rows = await prisma[model].findMany({ where, select });
    for (const row of rows) {
      const data = {};
      for (const [field, kind] of Object.entries(fields)) {
        const next = formatAs(kind, row[field]);
        if (typeof row[field] === 'string' && next !== row[field]) data[field] = next;
      }
      if (!Object.keys(data).length) continue;
      total += 1;
      for (const [field, next] of Object.entries(data)) console.log(`${label} ${row.id} ${field}: "${row[field]}" -> "${next}"`);
      if (apply) await prisma[model].update({ where: { id: row.id }, data });
    }
  }
  console.log(`\n${total} record${total === 1 ? '' : 's'} ${apply ? 'updated' : 'would be updated'}.`
    + (apply || !total ? '' : ' Run again with --yes to apply.'));
  return { total };
}

module.exports = { run, TARGETS };

if (require.main === module) {
  run({ apply: process.argv.includes('--yes') })
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
