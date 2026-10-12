import { PIPELINE_COLUMNS, pipelineColumn } from '../../src/components/workspace/pipeline';

// The stage shown on the Applicants tab is worked out from the application's
// record every time - these are the rules it is worked out by.
describe('which stage an application is at', () => {
  test('the stages, in order', () => {
    expect(PIPELINE_COLUMNS.map((c) => c.key)).toEqual(['applied', 'system', 'committee', 'exco', 'interviews', 'offer', 'onboarding', 'closed']);
  });

  test('just submitted', () => {
    expect(pipelineColumn({ status: 'Submitted' })).toBe('applied');
  });

  test('under review is the system shortlist, until the committee opens rating', () => {
    expect(pipelineColumn({ status: 'UnderReview' }, false)).toBe('system');
    expect(pipelineColumn({ status: 'UnderReview' }, true)).toBe('committee');
    expect(pipelineColumn({ status: 'ShortlistProposed' }, false)).toBe('committee');
  });

  test('shortlisted waits for EXCO, then moves to interviews', () => {
    expect(pipelineColumn({ status: 'Shortlisted', excoApprovalId: null })).toBe('exco');
    expect(pipelineColumn({ status: 'Shortlisted', excoApprovalId: 4 })).toBe('interviews');
    // Interviewed before the EXCO step existed.
    expect(pipelineColumn({ status: 'Shortlisted', excoApprovalId: null, interviewRounds: [{ id: 1 }] })).toBe('interviews');
  });

  test.each(['InterviewScheduled', 'Interviewed'])('%s is interviews', (status) => {
    expect(pipelineColumn({ status })).toBe('interviews');
  });

  test('offered - unless the offer ended without a hire', () => {
    expect(pipelineColumn({ status: 'Offered', offer: { status: 'Recommended' } })).toBe('offer');
    expect(pipelineColumn({ status: 'Offered', offer: { status: 'Accepted' } })).toBe('offer');
    expect(pipelineColumn({ status: 'Offered' })).toBe('offer');
  });

  test.each(['Declined', 'Expired', 'Withdrawn'])('an offer that was %s is not progressing', (status) => {
    expect(pipelineColumn({ status: 'Offered', offer: { status } })).toBe('closed');
  });

  test.each(['Rejected', 'Withdrawn'])('%s is not progressing', (status) => {
    expect(pipelineColumn({ status })).toBe('closed');
  });

  test('marked as hired is onboarding, whatever else the record says', () => {
    expect(pipelineColumn({ status: 'Offered', offer: { status: 'Accepted' }, hire: { id: 1 } })).toBe('onboarding');
  });
});
