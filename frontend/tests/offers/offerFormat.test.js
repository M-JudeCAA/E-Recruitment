import {
  candidateOfferStatus, deadlineInfo, formatContract, formatDate, formatSalary, offerAwaitingAnswer
} from '../../src/components/offers/offerFormat';

const NOW = new Date('2026-10-12T09:00:00Z');
const hoursFromNow = (h) => new Date(NOW.getTime() + h * 3600000).toISOString();

describe('how an offer is worded', () => {
  test('the salary, which arrives as text', () => {
    expect(formatSalary({ salaryAmount: '4500000', salaryCurrency: 'UGX', salaryPeriod: 'Monthly' })).toBe('UGX 4,500,000 / month');
    expect(formatSalary({ salaryAmount: '60000.5', salaryCurrency: 'USD', salaryPeriod: 'Annual' })).toBe('USD 60,000.5 / year');
    expect(formatSalary({ salaryAmount: 1000 })).toBe('UGX 1,000 / month');
  });

  test('an offer with no terms yet has no salary or contract to show', () => {
    expect(formatSalary({})).toBeNull();
    expect(formatSalary(null)).toBeNull();
    expect(formatContract({})).toBeNull();
  });

  test('the kind of employment, with its length for a fixed term contract', () => {
    expect(formatContract({ employmentCategory: 'FixedTermContract', contractMonths: 24 })).toBe('Fixed term contract, 24 months');
    expect(formatContract({ employmentCategory: 'Secondment' })).toBe('Secondment');
    expect(formatContract({ employmentCategory: 'FullSecondment' })).toBe('Full secondment');
  });

  test('dates', () => {
    expect(formatDate('2026-08-16T12:00:00Z')).toBe('16 Aug 2026');
    expect(formatDate(null)).not.toBe('');
  });
});

// An issued offer past its answer deadline has lapsed for the candidate even
// before the hourly job marks it Expired - the API already refuses an answer.
describe('the offer as the candidate sees it', () => {
  test('an issued offer is open until its deadline', () => {
    expect(candidateOfferStatus({ status: 'Approved', responseDeadline: hoursFromNow(1) }, NOW)).toBe('Approved');
    expect(candidateOfferStatus({ status: 'Approved', responseDeadline: null }, NOW)).toBe('Approved');
  });

  test('and lapsed from the deadline on', () => {
    expect(candidateOfferStatus({ status: 'Approved', responseDeadline: NOW.toISOString() }, NOW)).toBe('Expired');
    expect(candidateOfferStatus({ status: 'Approved', responseDeadline: hoursFromNow(-1) }, NOW)).toBe('Expired');
  });

  test('the legacy "Extended" status reads as issued', () => {
    expect(candidateOfferStatus({ status: 'Extended', responseDeadline: hoursFromNow(48) }, NOW)).toBe('Approved');
  });

  test.each(['Accepted', 'Declined', 'Withdrawn', 'Expired'])('an offer already %s stays that way', (status) => {
    expect(candidateOfferStatus({ status, responseDeadline: hoursFromNow(-100) }, NOW)).toBe(status);
  });

  test('no offer', () => {
    expect(candidateOfferStatus(null, NOW)).toBeNull();
    expect(offerAwaitingAnswer(null)).toBe(false);
  });

  test('only an issued offer still inside its deadline can be answered', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(offerAwaitingAnswer({ status: 'Approved', responseDeadline: future })).toBe(true);
    expect(offerAwaitingAnswer({ status: 'Approved', responseDeadline: past })).toBe(false);
    expect(offerAwaitingAnswer({ status: 'Accepted', responseDeadline: future })).toBe(false);
  });
});

describe('time left to answer', () => {
  test('in days, urgent under three', () => {
    expect(deadlineInfo(hoursFromNow(24 * 5 + 1), NOW)).toEqual({ label: '5 days left', urgent: false, passed: false });
    expect(deadlineInfo(hoursFromNow(24 * 2 + 1), NOW)).toEqual({ label: '2 days left', urgent: true, passed: false });
    expect(deadlineInfo(hoursFromNow(25), NOW).label).toBe('1 day left');
  });

  test('in hours on the last day - never "0 hours"', () => {
    expect(deadlineInfo(hoursFromNow(5), NOW).label).toBe('5 hours left');
    expect(deadlineInfo(hoursFromNow(1), NOW).label).toBe('1 hour left');
    expect(deadlineInfo(hoursFromNow(0.2), NOW).label).toMatch(/^1 hour/);
  });

  test('once passed', () => {
    expect(deadlineInfo(hoursFromNow(-1), NOW)).toEqual({ label: 'Deadline passed', urgent: true, passed: true });
  });

  test('no deadline set', () => {
    expect(deadlineInfo(null, NOW)).toBeNull();
  });
});
