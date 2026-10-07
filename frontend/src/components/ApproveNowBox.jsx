import React from 'react';

// "Approve now" on the Organisation page's Add forms and import (backend
// services/orgApprovalService.js): shown to a Principal HR Officer or above,
// ticked by default. Unticked, what they add waits for another PHRO+ to
// approve it. Either way it is written to the audit log.
export default function ApproveNowBox({ checked, onChange, what }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, margin: '4px 0 14px' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <b style={{ fontWeight: 500 }}>Approve now</b>
        <span className="ws-note" style={{ display: 'block' }}>
          {checked
            ? `The ${what} can be used straight away. Recorded in the audit log as approved by you.`
            : `The ${what} waits for another Principal HR Officer or above to approve it.`}
        </span>
      </span>
    </label>
  );
}
