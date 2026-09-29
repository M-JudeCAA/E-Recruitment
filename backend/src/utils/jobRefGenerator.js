// Generates: UCAA/ADV/{INT|EXT}/{NNN}/{YYYY} (FR-ATS-023, BR-ATS-04)
//
// NNN is a running number per posting type per year, zero-padded to three
// digits (a 1000th advert in one year simply gets four). The number comes
// from the JobRefSequence counter row, never from counting existing
// vacancies, so a number is never handed out twice - not even after a
// vacancy is deleted. See vacancyModel.createWithJobRef, which allocates
// the number and creates the vacancy in one transaction, so a failed
// insert doesn't burn a number either.
//
// Refs issued before this format (UCAA/ADV/EXT/09/2026, with an optional
// -2 suffix) are left as they are. They can't collide with the new ones:
// the month segment is two digits, the running number at least three.
const { timeZone } = require('./interviewFormat');

function typeCodeFor(postingType) {
  return postingType === 'Internal' ? 'INT' : 'EXT';
}

// The year the advert is raised in, in APP_TIMEZONE - a vacancy raised just
// after midnight on 1 January in Kampala belongs to the new year even when
// the server runs in UTC.
function refYear(date) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), year: 'numeric' }).format(date));
  } catch (err) {
    return date.getUTCFullYear();
  }
}

function formatJobRef(typeCode, number, year) {
  return `UCAA/ADV/${typeCode}/${String(number).padStart(3, '0')}/${year}`;
}

module.exports = { typeCodeFor, refYear, formatJobRef };
