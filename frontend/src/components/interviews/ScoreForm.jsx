import React from 'react';
import { RATING_LABELS } from '../../utils/interviews';
import { inputStyle, hintText } from './formStyles';

// Computes what the backend will (interviewService.scoreFromCriteria), so
// the person scoring sees the resulting number before submitting.
export function previewScore(criteria, ratings) {
  if (!criteria?.length) return null;
  let weighted = 0;
  let total = 0;
  for (const c of criteria) {
    const r = ratings[c.id];
    if (!r) return null;
    weighted += c.weight * (r / 5);
    total += c.weight;
  }
  return Math.round((weighted / total) * 1000) / 10;
}

// One panelist's scoresheet - a 1-5 rating per rubric criterion, or a single
// 0-100 score when the round has no rubric - plus comments. Used both by HR
// entering scores on a panelist's behalf and by the panelist on their own
// link (PanelScoreAccess.jsx).
export default function ScoreForm({ criteria, ratings, onRatingsChange, score, onScoreChange, comments, onCommentsChange }) {
  const hasRubric = criteria?.length > 0;
  const computed = hasRubric ? previewScore(criteria, ratings) : null;

  return (
    <div>
      {hasRubric ? (
        <div role="group" aria-label="Rubric ratings">
          {criteria.map((c) => (
            <fieldset key={c.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', margin: '0 0 8px' }}>
              <legend style={{ fontSize: 14, fontWeight: 600, padding: '0 4px' }}>
                {c.name} <span style={{ ...hintText, fontWeight: 400 }}>· weight {c.weight}</span>
              </legend>
              {c.description && <div style={{ ...hintText, marginBottom: 6 }}>{c.description}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = ratings[c.id] === n;
                  return (
                    <button
                      key={n} type="button" onClick={() => onRatingsChange({ ...ratings, [c.id]: n })}
                      aria-pressed={active} title={RATING_LABELS[n]}
                      style={{
                        minWidth: 44, padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'inherit',
                        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        background: active ? 'var(--color-primary)' : 'var(--color-bg)', color: active ? '#fff' : 'var(--color-text)',
                        fontWeight: 600
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
                {ratings[c.id] && <span style={{ ...hintText, alignSelf: 'center' }}>{RATING_LABELS[ratings[c.id]]}</span>}
              </div>
            </fieldset>
          ))}
          <div style={{ fontSize: 14, margin: '4px 0 12px' }}>
            Resulting score: <strong>{computed != null ? `${computed} / 100` : 'rate every criterion'}</strong>
          </div>
        </div>
      ) : (
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>Overall score (0-100)</span>
          <input type="number" min="0" max="100" value={score} onChange={(e) => onScoreChange(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        </label>
      )}
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>Comments</span>
        <textarea
          value={comments} onChange={(e) => onCommentsChange(e.target.value)} rows={4}
          placeholder="Evidence behind the score - strengths, concerns, anything the panel should discuss"
          style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
        />
      </label>
    </div>
  );
}

// Validation shared by both callers - returns an error message or null.
export function validateScore(criteria, ratings, score) {
  if (criteria?.length) {
    const missing = criteria.find((c) => !ratings[c.id]);
    return missing ? `Rate "${missing.name}"` : null;
  }
  const n = Number(score);
  if (score === '' || !Number.isFinite(n) || n < 0 || n > 100) return 'Enter a score between 0 and 100';
  return null;
}
