const mockDb = {
  application: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
  applicationDocument: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), delete: jest.fn() },
  panelDayLink: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  interviewDay: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  shortlistExercise: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  shortlistMember: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  shortlistAssignment: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), createMany: jest.fn(), update: jest.fn() },
  shortlistRating: { upsert: jest.fn(), deleteMany: jest.fn() },
  shortlistDecision: { upsert: jest.fn() },
  vacancy: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  offer: { update: jest.fn(), updateMany: jest.fn(), count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  workExperience: { findMany: jest.fn() },
  education: { findMany: jest.fn() },
  certificate: { findMany: jest.fn() },
  examGrade: { findMany: jest.fn() },
  auditLog: { create: jest.fn(), findMany: jest.fn() },
  jobRefSequence: { findUnique: jest.fn() },
  vacancyDraft: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  candidate: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  internalProfile: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  panelMember: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  interviewRound: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  panelAccessToken: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  position: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  department: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  directorate: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  staffUser: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  delegation: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  delegationUsage: { create: jest.fn(), findMany: jest.fn() },
  slaPolicy: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
  taskEscalation: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  notification: { create: jest.fn(), findMany: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  candidateNotification: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  systemHealth: { findMany: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  verificationToken: { deleteMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  pendingCandidateRegistration: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
  dataAccessLog: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() }
};

// Self-referencing so `tx.offer.updateMany(...)` etc. inside a
// `prisma.$transaction(async (tx) => ...)` callback hit the exact same
// jest.fn()s as `prisma.offer.updateMany(...)` would directly - tests set
// expectations on the plain mockDb.<model> methods either way. Supports
// both the interactive (callback) and batch (array of promises) forms.
mockDb.$transaction = jest.fn((arg) => (typeof arg === 'function' ? arg(mockDb) : Promise.all(arg)));

// Raw SQL - used for the vacancy row lock (SELECT ... FOR UPDATE) in
// workflowService.acceptOfferTransactionally.
mockDb.$queryRaw = jest.fn();

// Raw SQL writes - the job reference counter upsert in
// vacancyModel.createWithJobRef.
mockDb.$executeRaw = jest.fn();

module.exports = mockDb;
