import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Card from './Card';
import Select from './Select';
import Button from './Button';
import { levelLabel } from '../utils/positionLevels';

// The approved headcount per position (FR-ATS-006; backend headcountService):
// how many posts the establishment allows and how many are filled now. A
// vacancy asking for more than are free needs a reason and a Director's
// authorisation. Anyone in HR sees it; a Principal HR Officer+ sets it.
// Mark as Hired adds one to "filled".

function Row({ position, editable, onSaved }) {
  const [headcount, setHeadcount] = useState(position.headcount ?? '');
  const [occupied, setOccupied] = useState(position.occupied ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);
  useEffect(() => {
    staffClient.get(`/api/positions/${position.id}/headcount`).then((res) => setInfo(res.data)).catch(() => {});
  }, [position.id, position.headcount, position.occupied]);
  const changed = String(headcount) !== String(position.headcount ?? '') || String(occupied) !== String(position.occupied ?? 0);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const res = await staffClient.put(`/api/positions/${position.id}/headcount`, { headcount: headcount === '' ? null : Number(headcount), occupied: Number(occupied) || 0 });
      setInfo(res.data); onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const cell = { padding: '6px 8px', borderTop: '1px solid var(--color-border)', fontSize: 13, verticalAlign: 'middle' };
  const input = { width: 70, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' };
  return (
    <tr>
      <td style={cell}>{position.name} <span style={{ color: 'var(--color-text-muted)' }}>({levelLabel(position.level)})</span></td>
      <td style={cell}>{editable ? <input type="number" min="0" style={input} value={headcount} placeholder="-" aria-label={`Approved posts for ${position.name}`} onChange={(e) => setHeadcount(e.target.value)} /> : (position.headcount ?? '-')}</td>
      <td style={cell}>{editable ? <input type="number" min="0" style={input} value={occupied} aria-label={`Filled posts for ${position.name}`} onChange={(e) => setOccupied(e.target.value)} /> : position.occupied}</td>
      <td style={cell}>{info?.headcount == null ? <span style={{ color: 'var(--color-text-muted)' }}>not recorded</span> : `${info.inRecruitment} being recruited, ${info.available} free`}</td>
      {editable && (
        <td style={cell}>
          <Button variant="secondary" style={{ padding: '3px 10px', fontSize: 12 }} disabled={!changed} loading={busy} onClick={save}>Save</Button>
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 12 }}>{error}</div>}
        </td>
      )}
    </tr>
  );
}

export default function PositionHeadcountCard({ departments, editable }) {
  const [departmentId, setDepartmentId] = useState('');
  const [positions, setPositions] = useState([]);
  useEffect(() => {
    if (!departmentId) { setPositions([]); return; }
    staffClient.get(`/api/departments/${departmentId}/positions`).then((res) => setPositions(res.data)).catch(() => setPositions([]));
  }, [departmentId]);
  return (
    <Card accent="var(--color-accent)">
      <h3 style={{ marginTop: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Users size={18} /> Approved headcount</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        How many posts each position may have and how many are filled. A vacancy asking for more than are free needs a reason,
        and a Director must authorise it. Leave the approved number empty where it isn't known - nothing is checked then.
      </p>
      <Select label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
        <option value="">Select a department</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.directorate.name} &mdash; {d.name}</option>)}
      </Select>
      {departmentId && (positions.length === 0 ? <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No positions in this department yet.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Position', 'Approved posts', 'Filled', 'Free', ...(editable ? [''] : [])].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 12, padding: '4px 8px' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {positions.map((p) => <Row key={p.id} position={p} editable={editable} onSaved={(u) => setPositions((list) => list.map((x) => (x.id === u.id ? { ...x, ...u } : x)))} />)}
          </tbody>
        </table>
      ))}
    </Card>
  );
}
