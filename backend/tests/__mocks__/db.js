module.exports = {
  application: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  vacancy: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  offer: { update: jest.fn(), count: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  workExperience: { findMany: jest.fn() },
  education: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
  candidate: { findUnique: jest.fn() },
  panelMember: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  interviewRound: { create: jest.fn(), update: jest.fn(), count: jest.fn() },
  panelAccessToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  position: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  department: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  directorate: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() }
};
