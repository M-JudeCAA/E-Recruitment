import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScreeningQuestionsEditor from '../../src/components/ScreeningQuestionsEditor';

// UAT-031: HR says whether a question's evidence is an academic document
// (covered by the candidate's academic documents) - ticked from its wording
// until HR decides.
test('the Academic document tick follows the label until HR sets it', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const degree = { id: 'd1', text: 'Degree in IT?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Degree certificate' };
  const licence = { id: 'd2', text: 'ATC licence?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Copy of your ATC licence' };
  render(<ScreeningQuestionsEditor desirableItems={[]} disqualifyingItems={[degree, licence]} onChange={onChange} />);
  const [degreeTick, licenceTick] = screen.getAllByRole('checkbox', { name: 'Academic document' });
  expect(degreeTick).toBeChecked();
  expect(licenceTick).not.toBeChecked();
  await user.click(degreeTick);
  expect(onChange).toHaveBeenCalledWith({ disqualifyingRequirements: [{ ...degree, evidenceAcademic: false }, licence] });
});
