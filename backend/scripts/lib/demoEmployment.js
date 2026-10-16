// Seeders' internal profiles: the department and position are picked from
// the organisation structure (GET /api/candidates/me/organisation), as an
// employee does on Internal Careers - matched by the department's code or
// name and the position's name, else the first that exists.
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

async function withEmployment(api, token, { department, position, ...rest }) {
  const { departments, positions } = await api('GET', '/api/candidates/me/organisation', { token });
  const staffed = departments.filter((d) => positions.some((p) => p.departmentId === d.id));
  if (!staffed.length) throw new Error('No approved department with positions to put an internal candidate in - seed the organisation first.');
  const dept = staffed.find((d) => same(d.code, department) || same(d.name, department)) || staffed[0];
  const inDept = positions.filter((p) => p.departmentId === dept.id);
  const post = inDept.find((p) => same(p.name, position)) || inDept[0];
  return { ...rest, departmentId: dept.id, positionId: post.id };
}

module.exports = { withEmployment };
