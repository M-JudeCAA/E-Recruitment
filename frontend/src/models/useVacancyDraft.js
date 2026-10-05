import { useCallback, useEffect, useRef, useState } from 'react';
import staffClient from './staffApiClient';

// Saving the New Listing form as a draft (/api/vacancy-drafts) - by hand
// with saveNow(), and automatically a couple of seconds after HR stops
// typing. `values` is what gets saved ({ form, requisition }); nothing is
// saved while `enabled` is false (no requisition read yet, or paused while
// the vacancy is being created). The first save creates the draft and
// reports its id through onCreated (the page puts it in the URL).
//
// status: 'idle' (nothing to save) | 'unsaved' | 'saving' | 'saved' |
// 'error' (retried on the next change or saveNow) | 'conflict' (saved
// from another window since this one loaded it - auto-save stops so this
// window can't overwrite it; reload to continue).

const AUTOSAVE_DELAY_MS = 2000;

export default function useVacancyDraft({ values, enabled, onCreated }) {
  const [status, setStatus] = useState('idle');
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');
  const draftId = useRef(null);
  const baseUpdatedAt = useRef(null);
  const lastSaved = useRef(null); // the snapshot last saved or loaded
  const inFlight = useRef(null);
  const timer = useRef(null);
  const conflicted = useRef(false);
  const snapshot = JSON.stringify(values);
  const latest = useRef({ values, snapshot });
  latest.current = { values, snapshot };

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (conflicted.current) return false;
    if (inFlight.current) await inFlight.current.catch(() => {});
    const { values: toSave, snapshot: saving } = latest.current;
    if (saving === lastSaved.current && draftId.current) { setStatus('saved'); return true; }

    setStatus('saving');
    const request = draftId.current
      ? staffClient.put(`/api/vacancy-drafts/${draftId.current}`, { ...toSave, baseUpdatedAt: baseUpdatedAt.current })
      : staffClient.post('/api/vacancy-drafts', toSave);
    inFlight.current = request;
    try {
      const res = await request;
      const isNew = !draftId.current;
      draftId.current = res.data.id;
      baseUpdatedAt.current = res.data.updatedAt;
      lastSaved.current = saving;
      setSavedAt(new Date(res.data.updatedAt));
      setError('');
      // Typed more while this save was in flight - that is still unsaved.
      setStatus(latest.current.snapshot === saving ? 'saved' : 'unsaved');
      if (isNew && onCreated) onCreated(res.data.id);
      return true;
    } catch (err) {
      if (err.response?.data?.code === 'DRAFT_CHANGED') {
        conflicted.current = true;
        setStatus('conflict');
      } else {
        setStatus('error');
      }
      setError(err.response?.data?.error || 'The draft could not be saved');
      return false;
    } finally {
      inFlight.current = null;
    }
  }, [onCreated]);

  // Auto-save after a pause in typing.
  useEffect(() => {
    if (!enabled || conflicted.current) return undefined;
    if (snapshot === lastSaved.current) return undefined;
    setStatus((s) => (s === 'saving' ? s : 'unsaved'));
    timer.current = setTimeout(save, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [snapshot, enabled, save]);

  // Warn before leaving the page with changes not yet saved.
  useEffect(() => {
    if (!(enabled && (status === 'unsaved' || status === 'saving' || status === 'error'))) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [enabled, status]);

  // A draft opened from the list: what it holds counts as already saved.
  const markLoaded = useCallback((draft, loadedValues) => {
    draftId.current = draft.id;
    baseUpdatedAt.current = draft.updatedAt;
    lastSaved.current = JSON.stringify(loadedValues);
    setSavedAt(new Date(draft.updatedAt));
    setStatus('saved');
  }, []);

  const cancelPending = useCallback(() => clearTimeout(timer.current), []);

  return { status, savedAt, error, draftId: draftId.current, saveNow: save, markLoaded, cancelPending };
}
