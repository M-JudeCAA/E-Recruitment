jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const inbox = require('../src/services/inboxService');

// A Principal HR Officer recommends an offer, a Manager checks it and
// forwards it, a Director approves it: the Inbox lists it for one of the
// two at a time.
const offer = (overrides = {}) => ({
  id: 20, recommendedById: 5, recommendedDate: new Date('2026-10-20'), checkedById: null, checkedAt: null,
  recommendedBy: { name: 'Pat PHRO' }, checkedBy: null,
  application: { id: 44, vacancyId: 3, candidate: { fullName: 'Ann Applicant' }, vacancy: { title: 'Pilot', jobRef: 'REF/1' } },
  ...overrides
});
const CHECKED = { checkedById: 4, checkedAt: new Date('2026-10-21'), checkedBy: { name: 'Mo Manager' } };

async function itemsFor(id, role, offers) {
  prisma.delegation.findFirst.mockResolvedValue(null);
  prisma.vacancy.findMany.mockResolvedValue([]);
  prisma.staffUser.findMany.mockResolvedValue([]);
  prisma.internalProfile.findMany.mockResolvedValue([]);
  prisma.offer.findMany.mockResolvedValue(offers);
  prisma.dataSubjectRequest.findMany.mockResolvedValue([]);
  const { items } = await inbox.forStaff({ user: { id, type: 'staff', role } });
  return items.filter((i) => i.key.startsWith('offer-'));
}

beforeEach(() => jest.clearAllMocks());

test('an offer nobody has checked is for the Managers to check, not the Directors', async () => {
  expect(await itemsFor(4, 'Manager', [offer()])).toEqual([expect.objectContaining({ key: 'offer-20', kind: 'Offer to check' })]);
  expect(await itemsFor(2, 'Director', [offer()])).toEqual([]);
});

test('a checked offer is for the Directors to approve, not the Managers', async () => {
  expect(await itemsFor(2, 'Director', [offer(CHECKED)])).toEqual([
    expect.objectContaining({ kind: 'Offer approval', context: expect.stringMatching(/checked by Mo Manager/) })
  ]);
  expect(await itemsFor(6, 'Manager', [offer(CHECKED)])).toEqual([]);
});

test('nobody is asked to check what they recommended, or approve what they checked', async () => {
  expect(await itemsFor(5, 'Manager', [offer()])).toEqual([]);
  expect(await itemsFor(4, 'Director', [offer({ ...CHECKED })])).toEqual([]);
});
