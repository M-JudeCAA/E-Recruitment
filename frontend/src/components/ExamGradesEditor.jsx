import { useState } from 'react';
import { Plus } from 'lucide-react';
import TextField from './TextField';
import Select from './Select';
import Button from './Button';
import { useConfirm } from './ConfirmDialog';
import client from '../models/apiClient';

const O_LEVEL_GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const A_LEVEL_GRADES = ['A', 'B', 'C', 'D', 'E', 'O', 'F'];
const emptyGrade = { level: 'OLevel', subject: '', grade: '' };

// Self-contained CRUD editor for O-Level/A-Level exam grades, backing
// real machine-checked screening (Vacancy.requiredExamGrades - see
// screeningService.evaluateExamGrades) instead of a self-declared answer.
// Unlike Education/WorkExperience/Certificate (each duplicated separately
// in ProfileStep.jsx and ProfileCompletionForm.jsx), this manages its own
// API calls and is used identically in both - a new addition doesn't need
// to inherit that duplication just because the older sections happen to
// have it.
export default function ExamGradesEditor({ examGrades, onChange }) {
  const confirm = useConfirm();
  const [newGrade, setNewGrade] = useState(emptyGrade);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyGrade);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState({});
  const isBusy = (key) => !!busy[key];
  const runBusy = async (key, fn) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const gradesFor = (level) => (level === 'ALevel' ? A_LEVEL_GRADES : O_LEVEL_GRADES);
  const levelLabel = (level) => (level === 'ALevel' ? 'A-Level' : 'O-Level');

  const addGrade = async () => {
    if (!newGrade.subject || !newGrade.grade) {
      setError('Subject and grade are required');
      return;
    }
    setError('');
    try {
      await client.post('/api/candidates/me/exam-grades', newGrade);
      setNewGrade(emptyGrade);
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add exam grade');
    }
  };

  const startEdit = (g) => {
    setEditingId(g.id);
    setEditForm({ level: g.level, subject: g.subject, grade: g.grade });
  };
  const saveEdit = async () => {
    if (!editForm.subject || !editForm.grade) {
      setError('Subject and grade are required');
      return;
    }
    setError('');
    try {
      await client.put(`/api/candidates/me/exam-grades/${editingId}`, editForm);
      setEditingId(null);
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update exam grade');
    }
  };
  const deleteGrade = async (id) => {
    if (!(await confirm('Delete this exam grade? This cannot be undone.', { title: 'Delete exam grade', confirmLabel: 'Delete', danger: true }))) return;
    setError('');
    try {
      await client.delete(`/api/candidates/me/exam-grades/${id}`);
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete exam grade');
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>O-Level / A-Level exam grades</h3>
      {(examGrades || []).length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No exam grades on file yet (optional, only needed if a role requires one).</p>
      )}
      {(examGrades || []).map((g) => editingId === g.id ? (
        <div key={g.id} style={{ marginTop: 12, marginBottom: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4" style={{ maxWidth: 640 }}>
            <Select label="Level" value={editForm.level} onChange={(e) => setEditForm({ ...editForm, level: e.target.value, grade: '' })}>
              <option value="OLevel">O-Level</option>
              <option value="ALevel">A-Level</option>
            </Select>
            <TextField label="Subject" value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} />
            <Select label="Grade" value={editForm.grade} onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })}>
              <option value="">Select</option>
              {gradesFor(editForm.level).map((gr) => <option key={gr} value={gr}>{gr}</option>)}
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" loading={isBusy('editGrade')} loadingText="Saving..." onClick={() => runBusy('editGrade', saveEdit)}>Save changes</Button>
            <Button type="button" variant="ghost" disabled={isBusy('editGrade')} onClick={() => setEditingId(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div key={g.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>{levelLabel(g.level)} <strong>{g.subject}</strong> - grade {g.grade}</span>
          <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <Button type="button" variant="ghost" onClick={() => startEdit(g)}>Edit</Button>
            <Button type="button" variant="ghost" loading={isBusy(`delete-grade-${g.id}`)} loadingText="Deleting..." onClick={() => runBusy(`delete-grade-${g.id}`, () => deleteGrade(g.id))}>Delete</Button>
          </span>
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4" style={{ maxWidth: 640 }}>
          <Select label="Level" value={newGrade.level} onChange={(e) => setNewGrade({ ...newGrade, level: e.target.value, grade: '' })}>
            <option value="OLevel">O-Level</option>
            <option value="ALevel">A-Level</option>
          </Select>
          <TextField label="Subject" placeholder="e.g. Mathematics" value={newGrade.subject} onChange={(e) => setNewGrade({ ...newGrade, subject: e.target.value })} />
          <Select label="Grade" value={newGrade.grade} onChange={(e) => setNewGrade({ ...newGrade, grade: e.target.value })}>
            <option value="">Select</option>
            {gradesFor(newGrade.level).map((gr) => <option key={gr} value={gr}>{gr}</option>)}
          </Select>
        </div>
        <Button type="button" variant="ghost" loading={isBusy('addGrade')} loadingText="Adding..." onClick={() => runBusy('addGrade', addGrade)}><Plus size={14} /> Add exam grade</Button>
      </div>
      {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 12 }}>{error}</p>}
    </div>
  );
}
