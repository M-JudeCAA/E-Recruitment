// UNEB's two secondary-school grading scales, genuinely different shapes -
// see the SecondaryLevel schema comment. Encoded here once so
// screeningService and any future caller compare grades exactly the same
// way rather than each re-deriving the direction.

// O-Level (UCE): 1-9 per subject, LOWER is better.
//   Distinction: 1-2, Credit: 3-6, Pass: 7-8, Fail: 9
function meetsOLevelGrade(candidateGrade, requiredGrade) {
  const candidate = Number(candidateGrade);
  const required = Number(requiredGrade);
  if (!Number.isInteger(candidate) || !Number.isInteger(required)) return false;
  return candidate <= required;
}

// A-Level (UACE): letter grades per subject, HIGHER is better.
//   A(6) > B(5) > C(4) > D(3) > E(2) > O(1, subsidiary pass) > F(0, fail)
const A_LEVEL_RANK = { A: 6, B: 5, C: 4, D: 3, E: 2, O: 1, F: 0 };

function meetsALevelGrade(candidateGrade, requiredGrade) {
  const candidateRank = A_LEVEL_RANK[candidateGrade];
  const requiredRank = A_LEVEL_RANK[requiredGrade];
  if (candidateRank === undefined || requiredRank === undefined) return false;
  return candidateRank >= requiredRank;
}

function meetsGrade(level, candidateGrade, requiredGrade) {
  return level === 'OLevel'
    ? meetsOLevelGrade(candidateGrade, requiredGrade)
    : meetsALevelGrade(candidateGrade, requiredGrade);
}

module.exports = { meetsOLevelGrade, meetsALevelGrade, meetsGrade, A_LEVEL_RANK };
