import React, { useCallback, useEffect, useState } from 'react';
import { FileText, RotateCcw, Save, Eye } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import RichTextField from '../components/RichTextField';
import LoadingState from '../components/LoadingState';
import { useConfirm } from '../components/ConfirmDialog';
import { documentPage } from '../utils/printDocument';

// The documents the system prints - offer letter, appointing instrument,
// interview invitation, regret letter, EXCO shortlist - with UCAA's own
// default wording until official templates are supplied. Anyone in HR can
// read them; HR Manager+ edits them (backend documentController). A
// placeholder like {{candidateName}} is filled from the record when the
// document is made.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function DocumentTemplates() {
  const { staff } = useAuth();
  const canEdit = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager;
  const confirm = useConfirm();
  const [list, setList] = useState(null);
  const [key, setKey] = useState(null);
  const [template, setTemplate] = useState(null);
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => staffClient.get('/api/documents/templates')
    .then((res) => { setList(res.data); setKey((k) => k || res.data[0]?.key); })
    .catch((err) => setError(err.response?.data?.error || 'Could not load the templates')), []);
  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (!key) return;
    setError(''); setNotice(''); setPreview(null);
    staffClient.get(`/api/documents/templates/${key}`)
      .then((res) => { setTemplate(res.data); setBody(res.data.body); })
      .catch((err) => setError(err.response?.data?.error || 'Could not load the template'));
  }, [key]);

  const dirty = template && body !== template.body;

  const showPreview = async () => {
    setError('');
    try {
      const res = await staffClient.post(`/api/documents/templates/${key}/preview`, { body });
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not preview the template');
    }
  };

  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await staffClient.put(`/api/documents/templates/${key}`, { body });
      setTemplate(res.data); setBody(res.data.body);
      setNotice('Saved. Every document made from now on uses this wording.');
      loadList();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the template');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!(await confirm('Put the default wording back? Your changes to this template are lost.', { title: 'Reset template', confirmLabel: 'Reset', danger: true }))) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await staffClient.delete(`/api/documents/templates/${key}`);
      setTemplate(res.data); setBody(res.data.body);
      setNotice('The default wording is back.');
      loadList();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset the template');
    } finally {
      setBusy(false);
    }
  };

  // Inserted where the cursor is in the editor (the chip keeps the focus there).
  const insert = (placeholder) => document.execCommand('insertText', false, `{{${placeholder}}}`);

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="templates" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <PageHeader title="Document templates" subtitle="The letters and sheets the system prints, filled in from each record" />
        <Alert type="error" message={error} />
        <Alert type="success" message={notice} />
        {!list ? <LoadingState /> : (
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Card style={{ flex: '0 0 240px', padding: 0, overflow: 'hidden' }}>
              {list.map((t) => (
                <button key={t.key} type="button" onClick={() => setKey(t.key)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--color-border)',
                  background: t.key === key ? 'var(--color-primary-light)' : 'var(--color-bg)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14
                }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}><FileText size={14} /> {t.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {t.edited ? `Edited${t.updatedBy ? ` by ${t.updatedBy.name}` : ''}` : 'Default wording'}
                  </span>
                </button>
              ))}
            </Card>
            {template && (
              <Card style={{ flex: '1 1 480px', minWidth: 0 }}>
                <h3 style={{ margin: '0 0 4px' }}>{template.name}</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>{template.description}</p>
                {canEdit ? (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>Click into the text, then a field to insert it there:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {template.placeholders.map((p) => (
                        <button key={p.key} type="button" title={p.label} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.key)}
                          style={{ fontSize: 12, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--color-border)', background: 'var(--color-bg-subtle)', cursor: 'pointer', fontFamily: 'inherit' }}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <RichTextField value={body} onChange={setBody} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button onClick={save} disabled={!dirty} loading={busy}><Save size={14} /> Save</Button>
                      <Button variant="secondary" onClick={showPreview}><Eye size={14} /> Preview with sample details</Button>
                      {template.edited && <Button variant="ghost" onClick={reset} disabled={busy}><RotateCcw size={14} /> Reset to default</Button>}
                    </div>
                  </>
                ) : (
                  <>
                    <Alert type="info" message="An HR Manager or Director can change this wording." />
                    <Button variant="secondary" onClick={showPreview}><Eye size={14} /> Preview with sample details</Button>
                  </>
                )}
                {preview && (
                  <div style={{ marginTop: 16 }}>
                    {preview.unknown?.length > 0 && (
                      <Alert type="warning" message={`Not a field of this document, left as typed: ${preview.unknown.map((u) => `{{${u}}}`).join(', ')}`} />
                    )}
                    <iframe title="Preview" srcDoc={documentPage(preview.title, preview.html, { printButton: false })}
                      style={{ width: '100%', height: 640, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: '#fff' }} />
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
