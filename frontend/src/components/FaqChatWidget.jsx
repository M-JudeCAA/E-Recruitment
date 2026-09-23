import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Bot, User, RotateCcw } from 'lucide-react';
import { FAQ_ITEMS } from '../data/faqItems';
import { HEAD_OFFICE_CONTACTS } from './HowToApplyBlock';

// A chat-STYLED skin over the exact same canned FAQ_ITEMS the on-page
// accordion (Home.jsx) renders - deliberately NOT an LLM. Two reasons:
//
// 1. This is a government recruitment site. A free-text AI answering
//    questions about fees, deadlines, or eligibility can hallucinate a
//    rule that was never true - a wrong answer here is a much worse
//    failure than on a marketing site. Every word this widget can ever
//    show a visitor is one of the fixed strings in faqItems.js, reviewed
//    the same way the accordion's copy is.
// 2. It needs no backend, no API key, and no per-request cost - the
//    entire "conversation" is client-side state over a static array.
//
// For that same reason there is deliberately NO free-text input - only
// buttons for the fixed question list. A text box would imply the
// assistant can understand any question, which it can't; buttons keep
// the affordance honest about what this actually is.
const GREETING = "Hi! I'm the UCAA Careers Assistant. Tap a question below and I'll answer it.";
const CLOSING = `That's everything I can answer here. For anything else, contact Head Office: ${HEAD_OFFICE_CONTACTS.join(', ')}, or careers@caa.co.ug.`;

function Bubble({ from, children }) {
  const isBot = from === 'bot';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: isBot ? 'row' : 'row-reverse' }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isBot ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)', color: isBot ? 'var(--color-primary)' : 'var(--color-text-muted)'
      }}>
        {isBot ? <Bot size={15} /> : <User size={15} />}
      </div>
      <div style={{
        maxWidth: '80%', padding: '9px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
        background: isBot ? 'var(--color-bg-subtle)' : 'var(--color-primary)',
        color: isBot ? 'var(--color-text)' : '#fff',
        borderTopLeftRadius: isBot ? 4 : 12, borderTopRightRadius: isBot ? 12 : 4
      }}>
        {children}
      </div>
    </div>
  );
}

export default function FaqChatWidget() {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState([{ from: 'bot', text: GREETING }]);
  const [askedIndices, setAskedIndices] = useState([]);
  const scrollRef = useRef(null);
  const panelId = 'faq-chat-panel';

  const remaining = FAQ_ITEMS.map((item, i) => ({ ...item, i })).filter(({ i }) => !askedIndices.includes(i));

  const ask = (i) => {
    const item = FAQ_ITEMS[i];
    setTranscript((t) => [...t, { from: 'user', text: item.q }, { from: 'bot', text: item.a }]);
    setAskedIndices((prev) => {
      const next = [...prev, i];
      if (next.length === FAQ_ITEMS.length) {
        setTranscript((t) => [...t, { from: 'bot', text: CLOSING }]);
      }
      return next;
    });
  };

  const restart = () => {
    setTranscript([{ from: 'bot', text: GREETING }]);
    setAskedIndices([]);
  };

  // Auto-scroll to the newest message - a chat transcript that doesn't
  // follow its own new content reads as broken.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div style={{
      position: 'fixed', right: 20, bottom: 'calc(var(--footer-height) + 16px)', zIndex: 200,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12
    }}>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="UCAA careers FAQ chat"
          style={{
            width: 'min(340px, calc(100vw - 40px))', height: 440, maxHeight: 'calc(100vh - var(--footer-height) - 100px)',
            background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
            boxShadow: '0 12px 32px rgba(20,24,28,0.18)', display: 'flex', flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px',
            background: 'var(--color-primary)', color: '#fff'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
              <Bot size={17} /> Careers Assistant
            </span>
            <button
              type="button" onClick={() => setOpen(false)} aria-label="Close chat"
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {transcript.map((m, i) => <Bubble key={i} from={m.from}>{m.text}</Bubble>)}
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {remaining.length > 0 ? remaining.map(({ q, i }) => (
              <button
                key={i}
                type="button"
                onClick={() => ask(i)}
                style={{
                  textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-primary)',
                  background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)', fontSize: 12.5,
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                }}
              >
                {q}
              </button>
            )) : (
              <button
                type="button" onClick={restart}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px',
                  borderRadius: 8, border: '1px solid var(--color-border)', background: 'none',
                  color: 'var(--color-text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                }}
              >
                <RotateCcw size={13} /> Start over
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close careers FAQ chat' : 'Open careers FAQ chat'}
        style={{
          width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 18px rgba(20,24,28,0.25)', flexShrink: 0
        }}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </div>
  );
}
