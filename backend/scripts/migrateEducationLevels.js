// One-time script - run once, after the schema migration adds the new
// nullable EducationLevel enum column alongside (not replacing) the old
// free-text one. Maps what it can confidently map; leaves everything
// else null for a human to correct via the candidate's own "Edit
// Education" screen, which now presents a dropdown instead of free text.
//
// Deliberately conservative: this dictionary covers common, unambiguous
// variants only. Something like "Grade 12 Certificate" is left unmapped
// on purpose - it is genuinely ambiguous (a secondary-school leaving
// certificate is a different kind of fact than a post-secondary
// Certificate qualification) and guessing wrong here would silently
// misinform every future screening result that candidate is ever
// compared against.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MAPPING = {
  'certificate': 'Certificate', 'cert': 'Certificate',
  'diploma': 'Diploma', 'dip': 'Diploma', 'higher diploma': 'Diploma', 'higher national diploma': 'Diploma',
  'bachelors': 'Bachelors', "bachelor's": 'Bachelors', "bachelor's degree": 'Bachelors',
  'bachelors degree': 'Bachelors', 'bachelor of science': 'Bachelors', 'bachelor of arts': 'Bachelors',
  'bsc': 'Bachelors', 'ba': 'Bachelors', 'bcom': 'Bachelors', 'undergraduate': 'Bachelors',
  'masters': 'Masters', "master's": 'Masters', "master's degree": 'Masters', 'masters degree': 'Masters',
  'msc': 'Masters', 'ma': 'Masters', 'mba': 'Masters', 'postgraduate': 'Masters',
  'phd': 'PhD', 'doctorate': 'PhD', 'doctor of philosophy': 'PhD'
};

function mapQualification(raw) {
  const key = raw.trim().toLowerCase();
  return MAPPING[key] || null;
}

async function main() {
  const educations = await prisma.education.findMany({ where: { qualificationLevel: null } });
  let mapped = 0, unmapped = 0;

  for (const edu of educations) {
    const level = mapQualification(edu.qualificationLevelText); // the old free-text column, temporarily kept alongside
    if (level) {
      await prisma.education.update({ where: { id: edu.id }, data: { qualificationLevel: level } });
      mapped++;
    } else {
      unmapped++;
      console.log(`  Could not map: Education #${edu.id} ("${edu.qualificationLevelText}") - candidate ${edu.candidateId}`);
    }
  }

  console.log(`\nMapped ${mapped} of ${educations.length} education records automatically.`);
  console.log(`${unmapped} record(s) need manual correction by the candidate or an HR admin - see the list above.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
