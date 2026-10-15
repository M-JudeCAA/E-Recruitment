import React, { useEffect, useState } from 'react';
import { Share2, Check } from 'lucide-react';
import Button from '../Button';
import { jobShareUrl, copyText } from '../../utils/jobShareLink';

/** Copies the vacancy's advert link: Internal Careers for Internal vacancies, the public site for External. */
export default function ShareJobButton({ vacancy }) {
  const [state, setState] = useState(null); // null | 'copied' | 'failed'
  const url = jobShareUrl(vacancy);
  const internal = vacancy.postingType === 'Internal';

  useEffect(() => {
    if (!state) return undefined;
    const t = setTimeout(() => setState(null), state === 'copied' ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [state]);

  const share = async () => {
    try {
      await copyText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {state === 'failed' && <span className="ws-note" style={{ overflowWrap: 'anywhere' }}>Couldn't copy - the link is {url}</span>}
      <Button variant="ghost" onClick={share} style={{ padding: '4px 10px' }}
        title={internal ? 'Copy the Internal Careers link - only UCAA staff can open it' : 'Copy the public careers site link'}>
        {state === 'copied' ? <Check size={14} /> : <Share2 size={14} />}
        {state === 'copied' ? 'Link copied' : (internal ? 'Share (staff only)' : 'Share')}
      </Button>
    </span>
  );
}
