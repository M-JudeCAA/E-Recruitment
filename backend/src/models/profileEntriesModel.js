const prisma = require('../config/db');

module.exports = {
  createWorkExperience: (data) => prisma.workExperience.create({ data }),
  createEducation: (data) => prisma.education.create({ data })
};
