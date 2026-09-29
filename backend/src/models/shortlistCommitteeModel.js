const prisma = require('../config/db');

// The shortlisting committee's tables - ShortlistExercise, ShortlistMember,
// ShortlistAssignment, ShortlistRating and ShortlistDecision - in one model
// file, since nothing uses them apart (see schema.prisma).

const MEMBER_ORDER = [{ isChair: 'desc' }, { id: 'asc' }];

module.exports = {
  // --- exercise ---
  // Whether a vacancy is shortlisted by a committee at all (hand-ranking is
  // closed to it - vacancyController.saveRanking, applicationController.shortlist).
  hasExercise: async (vacancyId) => Boolean(await prisma.shortlistExercise.findUnique({ where: { vacancyId }, select: { id: true } })),
  findExerciseByVacancy: (vacancyId) => prisma.shortlistExercise.findUnique({
    where: { vacancyId },
    include: { members: { orderBy: MEMBER_ORDER }, decisions: true }
  }),
  createExercise: (data) => prisma.shortlistExercise.create({ data }),
  updateExercise: (id, data) => prisma.shortlistExercise.update({ where: { id }, data }),
  // Stage moves are conditional on the stage just read, so two HR users
  // acting at once can't both move it.
  moveExercise: (id, fromStatus, data) => prisma.shortlistExercise.updateMany({ where: { id, status: fromStatus }, data }),

  // --- members ---
  findMember: (id) => prisma.shortlistMember.findUnique({ where: { id }, include: { exercise: true } }),
  findMemberByToken: (token) => prisma.shortlistMember.findUnique({
    where: { token },
    include: {
      exercise: {
        include: {
          vacancy: { select: { id: true, jobRef: true, title: true, positionsRequired: true } },
          members: { orderBy: MEMBER_ORDER },
          decisions: true
        }
      }
    }
  }),
  createMember: (data) => prisma.shortlistMember.create({ data }),
  updateMember: (id, data) => prisma.shortlistMember.update({ where: { id }, data }),
  deleteMember: (id) => prisma.shortlistMember.delete({ where: { id } }),
  // One chair per exercise - clearing the others before setting a new one.
  clearChair: (exerciseId) => prisma.shortlistMember.updateMany({ where: { exerciseId, isChair: true }, data: { isChair: false } }),
  markSubmitted: (id, at) => prisma.shortlistMember.updateMany({ where: { id, submittedAt: null }, data: { submittedAt: at } }),

  // --- assignments and ratings ---
  createAssignments: (rows) => prisma.shortlistAssignment.createMany({ data: rows, skipDuplicates: true }),
  // Every assignment of an exercise with its ratings - the input to the
  // ranking (shortlistCommitteeService.computeResults) and to progress.
  findAssignmentsForExercise: (exerciseId) => prisma.shortlistAssignment.findMany({
    where: { member: { exerciseId } },
    include: {
      ratings: true,
      member: { select: { id: true, name: true, isChair: true, submittedAt: true } }
    }
  }),
  findMemberAssignments: (memberId) => prisma.shortlistAssignment.findMany({
    where: { memberId },
    include: {
      ratings: { select: { criterionId: true, value: true } },
      application: { select: { id: true, candidate: { select: { fullName: true } } } }
    },
    orderBy: [{ calibration: 'desc' }, { applicationId: 'asc' }]
  }),
  findAssignment: (memberId, applicationId) => prisma.shortlistAssignment.findUnique({
    where: { memberId_applicationId: { memberId, applicationId } },
    include: { ratings: true }
  }),
  // Replaces a member's ratings of one applicant in one go.
  saveRatings: (assignmentId, ratings) => prisma.$transaction(ratings.map((r) => prisma.shortlistRating.upsert({
    where: { assignmentId_criterionId: { assignmentId, criterionId: r.criterionId } },
    create: { assignmentId, criterionId: r.criterionId, value: r.value, comment: r.comment },
    update: { value: r.value, comment: r.comment }
  }))),
  declareConflict: (assignmentId, reason, at) => prisma.$transaction([
    prisma.shortlistRating.deleteMany({ where: { assignmentId } }),
    prisma.shortlistAssignment.update({ where: { id: assignmentId }, data: { conflictAt: at, conflictReason: reason } })
  ]),
  // A document of an applicant this member was assigned - the only files a
  // committee member's link can open.
  findAssignmentOwningFile: (memberId, url) => prisma.shortlistAssignment.findFirst({
    where: {
      memberId,
      application: { OR: [{ coverLetterUrl: url }, { documents: { some: { fileUrl: url } } }] }
    }
  }),

  // --- chair decisions ---
  upsertDecision: (exerciseId, applicationId, criterionId, data) => prisma.shortlistDecision.upsert({
    where: { exerciseId_applicationId_criterionId: { exerciseId, applicationId, criterionId } },
    create: { exerciseId, applicationId, criterionId, ...data },
    update: { ...data, decidedAt: new Date() }
  }),

  // --- applications ---
  // The pool the committee assesses: screened applications still awaiting
  // a shortlisting decision.
  findPool: (vacancyId) => prisma.application.findMany({
    where: { vacancyId, status: 'UnderReview' },
    select: { id: true },
    orderBy: [{ submittedDate: 'asc' }, { id: 'asc' }]
  }),
  countByStatus: (vacancyId, statuses) => prisma.application.count({ where: { vacancyId, status: { in: statuses } } }),
  findForResults: (ids) => prisma.application.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, status: true, rankVersion: true,
      candidate: { select: { fullName: true, candidateType: true, workExperience: { select: { startDate: true, endDate: true } } } }
    }
  }),
  // What a committee member sees of one applicant: the profile and answers
  // they are assessing, and the documents - no contact details or ID numbers.
  findApplicantForPanel: (applicationId) => prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true, whyThisRole: true, desirableResponses: true, disqualifyingResponses: true,
      essentialCriteriaResults: true, coverLetterUrl: true,
      documents: { select: { id: true, category: true, label: true, fileUrl: true, originalName: true }, orderBy: { uploadedAt: 'asc' } },
      candidate: {
        select: {
          fullName: true, candidateType: true, location: true, flyingHours: true,
          education: true, workExperience: true, examGrades: true, certificates: true
        }
      }
    }
  }),
  snapshotResult: (id, data) => prisma.application.update({ where: { id }, data })
};
