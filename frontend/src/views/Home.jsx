import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Search, MapPin, Users, Calendar, ArrowRight, UserPlus, LogIn, Download,
  FileEdit, Send, ListChecks, ShieldCheck, TrendingUp, HeartHandshake, GraduationCap,
  AlertTriangle, RotateCw, X, Clock, ChevronDown, ShieldAlert, Briefcase, Building2, Plane, Sparkles
} from 'lucide-react';
import client from '../models/apiClient';
import Button from '../components/Button';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import LoadingState from '../components/LoadingState';
import ucaaLogo from '../assets/ucaa-logo.png';
import { useVacancyPdfDownload } from '../utils/useVacancyPdfDownload';
import { HEAD_OFFICE_CONTACTS } from '../components/HowToApplyBlock';
import { FAQ_ITEMS } from '../data/faqItems';
import FaqChatWidget from '../components/FaqChatWidget';

// A vacancy whose deadline has passed is still shown here (see
// vacancyController.listPublic's own comment - Vacancy.status is never
// mutated just because a deadline lapsed), tagged Closed with its Apply
// button swapped for a details-download one, rather than disappearing.
const isClosed = (v) => v.deadline && new Date(v.deadline) < new Date();

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole-day countdown, floored so "closes tonight" still reads as 0 (today)
// rather than -1/negative. Only meaningful for a vacancy that isn't closed
// yet - callers check isClosed(v) first.
function daysUntil(deadline) {
  return Math.floor((new Date(deadline) - new Date()) / DAY_MS);
}

// The one piece of urgency information a candidate actually acts on -
// deliberately louder (warning/danger color) the closer the deadline gets,
// rather than a flat "Apply by <date>" line that reads the same whether
// it's 90 days out or tomorrow.
function ClosingBadge({ deadline }) {
  if (!deadline) return null;
  const days = daysUntil(deadline);
  let text = `Closes ${new Date(deadline).toLocaleDateString()}`;
  let color = 'var(--color-text-muted)';
  if (days <= 0) { text = 'Closes today'; color = 'var(--color-danger)'; }
  else if (days === 1) { text = 'Closes tomorrow'; color = 'var(--color-danger)'; }
  else if (days <= 7) { text = `Closes in ${days} days`; color = 'var(--color-warning)'; }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: days <= 7 ? 700 : 400, color }}>
      <Clock size={14} /> {text}
    </span>
  );
}

// A single collapsible Q&A row. Plain <button> (not Card's onClick, which
// renders a <div>) so it's keyboard-operable and a screen reader announces
// it as a toggle - aria-expanded reflects the actual open state, and
// aria-controls/id tie the button to the answer it reveals.
function FaqItem({ q, a, open, onToggle, id }) {
  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          width: '100%', padding: '16px 4px', background: 'none', border: 'none', textAlign: 'left',
          fontSize: 15, fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'inherit'
        }}
      >
        {q}
        <ChevronDown size={18} color="var(--color-text-muted)" style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <p id={id} style={{ margin: '0 4px 16px', fontSize: 13.5, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          {a}
        </p>
      )}
    </div>
  );
}

// Same CSS-variable-backed palette as CandidateLogin.jsx/Navbar.jsx, so
// this full-bleed hero stays visually identical to the rest of the app's
// gradient surfaces even though it's assembled from inline styles here.
const ucaa = {
  navy: 'var(--color-primary-dark)',
  blue: 'var(--color-primary)',
};

const VALUES = [
  { icon: ShieldCheck, title: 'Meaningful work', text: "Play a direct role in keeping Uganda's skies safe, connected, and open for business." },
  { icon: TrendingUp, title: 'Room to grow', text: 'Structured training and clear paths for career progression across every directorate.' },
  { icon: HeartHandshake, title: 'Great benefits', text: 'Competitive pay, medical cover, and a genuinely supportive work environment.' },
  { icon: GraduationCap, title: 'Learning culture', text: 'Ongoing professional development, on the job and beyond it.' }
];

const STEPS = [
  { icon: UserPlus, title: 'Create your account', text: 'Sign up with your email in under a minute.' },
  { icon: FileEdit, title: 'Complete your profile', text: 'Add your education and experience once - reuse them for every application.' },
  { icon: Send, title: 'Apply to a role', text: 'Browse open positions and submit your application online.' },
  { icon: ListChecks, title: 'Track your status', text: 'Follow your application from review through to an offer, from your dashboard.' }
];

// Counts up from 0 to `target` once `active` flips true (the moment
// loading finishes) - a static number that was "—" a moment ago landing
// all at once reads as inert; counting up to it reads as alive. Skips the
// animation outright under prefers-reduced-motion, same convention as the
// skeleton shimmer in theme.css.
function useCountUp(target, active) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { setDisplay(target); return undefined; }
    let raf;
    const duration = 700;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setDisplay(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return display;
}

function Stat({ value, label, icon: Icon, loading }) {
  const display = useCountUp(typeof value === 'number' ? value : 0, !loading);
  return (
    <div style={{ padding: '22px 12px', textAlign: 'center' }}>
      {Icon && <Icon size={17} color="var(--color-primary)" style={{ marginBottom: 4 }} />}
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary-dark)', lineHeight: 1.1 }}>
        {loading ? '—' : display}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// Centered heading with a short two-tone accent bar underneath - the one
// typographic flourish repeated across every section (Why Us, How to
// Apply, Open Positions, FAQ) so the page reads as one designed system
// rather than a stack of plain <h2>s.
function SectionHeading({ title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 28 }}>
      <h2 style={{ color: 'var(--color-primary-dark)', marginBottom: 10 }}>{title}</h2>
      <span style={{
        display: 'block', width: 48, height: 4, borderRadius: 999, margin: '0 auto',
        background: 'linear-gradient(90deg, var(--color-primary), var(--color-gold))'
      }} />
      {subtitle && (
        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', maxWidth: 560, margin: '14px auto 0' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// Guest-only landing page (see App.jsx - registered as a full-bleed
// sibling route, not under PaddedLayout, so this hero can run edge to
// edge like Register/CandidateLogin do). A signed-in candidate is routed
// straight to /dashboard instead - see Navbar.jsx's logo link and
// ProtectedRoute usage elsewhere - so everything here can safely assume
// an anonymous visitor: the CTAs are "create an account" / "sign in",
// never "go to my dashboard".
export default function Home() {
  const [vacancies, setVacancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [titleSearch, setTitleSearch] = useState('');
  const [deptSearch, setDeptSearch] = useState('');
  const [openFaq, setOpenFaq] = useState(null);
  const { download, hiddenPrintArea, downloadingId } = useVacancyPdfDownload();
  const location = useLocation();

  const loadVacancies = () => {
    setLoading(true);
    setLoadError(false);
    client.get('/api/vacancies')
      .then((res) => setVacancies(res.data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(loadVacancies, []);

  // React Router's <Link to="/#open-positions"> (used by JobDetails.jsx's
  // "Back to Open Positions" and the footer's "FAQ" link) navigates via
  // pushState, which - unlike a plain <a href="#..."> or a full page
  // load - does NOT trigger the browser's native scroll-to-anchor
  // behavior. This replicates that behavior for the SPA case: on mount
  // (i.e. whenever this route is navigated to, hash included), scroll to
  // whatever element the hash names, if any.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  // Built from whatever vacancies actually loaded, not a separate lookup
  // call - there's no standalone "list of departments with open roles"
  // endpoint, and deriving it here means it can never list a department
  // with zero open positions.
  const departmentOptions = useMemo(
    () => [...new Set(vacancies.map((v) => v.department?.name).filter(Boolean))].sort(),
    [vacancies]
  );

  const hasActiveFilters = Boolean(titleSearch.trim() || deptSearch);

  const filtered = useMemo(() => {
    const title = titleSearch.trim().toLowerCase();
    const matches = vacancies.filter((v) =>
      (!title || v.title.toLowerCase().includes(title)) &&
      (!deptSearch || v.department?.name === deptSearch)
    );
    // Soonest-closing first (the most actionable thing for a visitor to
    // see), open-ended vacancies after all dated ones, closed vacancies
    // pushed to the very end regardless of when they closed.
    return [...matches].sort((a, b) => {
      const aClosed = isClosed(a), bClosed = isClosed(b);
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });
  }, [vacancies, titleSearch, deptSearch]);

  const departmentCount = useMemo(
    () => new Set(vacancies.map((v) => v.department?.name).filter(Boolean)).size,
    [vacancies]
  );
  const positionsCount = useMemo(
    () => vacancies.reduce((sum, v) => sum + (v.positionsRequired || 0), 0),
    [vacancies]
  );

  const runSearch = (e) => {
    e.preventDefault();
    document.getElementById('open-positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Hero */}
      <section
        style={{
          width: '100%', boxSizing: 'border-box', position: 'relative', overflow: 'hidden',
          background: `linear-gradient(160deg, ${ucaa.blue} 0%, ${ucaa.navy} 100%)`,
          color: '#fff', padding: '64px 20px 100px'
        }}
      >
        {/* Purely decorative depth - two soft blurred orbs (brand blue-light
            and the gold accent) sitting behind the content. aria-hidden and
            pointer-events:none since they carry no information and must
            never intercept clicks/taps meant for the form/buttons above
            them. Clipped by the section's own overflow:hidden. */}
        <div aria-hidden="true" style={{
          position: 'absolute', top: -80, right: '8%', width: 280, height: 280, borderRadius: '50%',
          background: 'var(--color-gold)', opacity: 0.18, filter: 'blur(70px)', pointerEvents: 'none'
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', bottom: -100, left: '5%', width: 320, height: 320, borderRadius: '50%',
          background: '#fff', opacity: 0.08, filter: 'blur(80px)', pointerEvents: 'none'
        }} />

        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 60, height: 60, borderRadius: 14, background: '#fff', padding: 8,
              marginBottom: 20, boxSizing: 'border-box'
            }}
          >
            <img src={ucaaLogo} alt="UCAA logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </span>

          {/* Eyebrow chip - real, live data (open position count) rather
              than a static "Now Hiring" label, so it's never stale and
              gives the hero one concrete, ever-changing fact up top. */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 999,
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.3)',
            fontSize: 12.5, fontWeight: 600, letterSpacing: 0.3, marginBottom: 18
          }}>
            <Sparkles size={13} color="var(--color-gold)" />
            {loading ? 'Careers at UCAA' : `${vacancies.length} open position${vacancies.length === 1 ? '' : 's'} - now hiring`}
          </div>

          <h1 style={{ fontSize: 'clamp(28px, 4.4vw, 42px)', fontWeight: 800, margin: '0 0 14px', lineHeight: 1.12, letterSpacing: -0.5 }}>
            Build Your Career<br />in <span style={{ color: 'var(--color-gold)' }}>Aviation</span>
          </h1>
          <p style={{ fontSize: 15.5, opacity: 0.92, maxWidth: 600, margin: '0 auto 28px' }}>
            Join the Uganda Civil Aviation Authority and help keep Uganda&rsquo;s skies safe, connected,
            and open for business. Explore open positions and apply online.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 32 }}>
            <Link to="/register" style={{ textDecoration: 'none' }}>
              <Button style={{ padding: '12px 22px', fontSize: 15 }}>
                <UserPlus size={16} /> Create an account
              </Button>
            </Link>
            <Link to="/login" style={{ textDecoration: 'none' }}>
              <Button
                variant="ghost"
                style={{ padding: '12px 22px', fontSize: 15, color: '#fff', borderColor: 'rgba(255,255,255,0.55)' }}
              >
                <LogIn size={16} /> Sign in
              </Button>
            </Link>
          </div>

          {/* Quick search - scrolls to and filters the Open Positions
              section below rather than navigating away, so a guest can
              gauge what's open before committing to an account. */}
          <form
            onSubmit={runSearch}
            style={{
              background: '#fff', borderRadius: 'var(--radius)', padding: 8,
              display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 620, margin: '0 auto',
              boxShadow: '0 16px 36px rgba(10,40,70,0.28)'
            }}
          >
            <input
              placeholder="Search job title..."
              aria-label="Search job title"
              value={titleSearch}
              onChange={(e) => setTitleSearch(e.target.value)}
              style={{
                flex: '1 1 200px', border: 'none', padding: '10px 12px',
                fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)', minWidth: 0
              }}
            />
            <select
              value={deptSearch}
              onChange={(e) => setDeptSearch(e.target.value)}
              aria-label="Filter by department"
              style={{
                flex: '1 1 170px', border: 'none', padding: '10px 12px',
                fontSize: 'inherit', fontFamily: 'inherit', color: deptSearch ? 'var(--color-text)' : 'var(--color-text-muted)',
                minWidth: 0, background: 'transparent'
              }}
            >
              <option value="">All departments</option>
              {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <Button type="submit" className="btn-attention" style={{ padding: '10px 18px', fontWeight: 700 }}>
              <Search size={16} /> Find Jobs
            </Button>
          </form>
        </div>

        {/* Wave divider - a soft curve into the page background instead of
            the hero's gradient ending in a hard straight edge. Sits behind
            the stats card below (that card's own -36px negative margin and
            z-index:1 already make it float above both the hero and this
            curve, so paint order here doesn't matter). */}
        <svg aria-hidden="true" viewBox="0 0 1440 60" preserveAspectRatio="none"
          style={{ display: 'block', width: '100%', height: 48, position: 'absolute', bottom: 0, left: 0 }}>
          <path d="M0,32 C320,64 1120,0 1440,28 L1440,60 L0,60 Z" fill="var(--color-bg)" />
        </svg>
      </section>

      {/* Stats strip - overlaps the hero's bottom edge */}
      <div style={{ maxWidth: 820, margin: '-36px auto 0', padding: '0 20px', position: 'relative', zIndex: 1 }}>
        <div
          style={{
            background: '#fff', borderRadius: 'var(--radius)',
            boxShadow: '0 10px 28px rgba(20,24,28,0.12)', border: '1px solid var(--color-border)',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))'
          }}
        >
          <Stat value={vacancies.length} loading={loading} icon={Briefcase} label="Open positions" />
          <Stat value={departmentCount} loading={loading} icon={Building2} label="Departments hiring" />
          <Stat value={positionsCount} loading={loading} icon={Users} label="Vacancies available" />
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '56px 20px 0', boxSizing: 'border-box' }}>
        {/* Why work with us */}
        <SectionHeading
          title="Why Build Your Career With Us"
          subtitle="A national regulator with a real mission, and a workplace that invests in the people behind it."
        />
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--spacing-md)', marginTop: 28, marginBottom: 56
          }}
        >
          {VALUES.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="hover-lift" style={{ textAlign: 'center', marginBottom: 0 }}>
              <div
                style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--color-primary-light), #fff)',
                  border: '1px solid var(--color-primary-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px'
                }}
              >
                <Icon size={22} color="var(--color-primary)" />
              </div>
              <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{text}</p>
            </Card>
          ))}
        </div>

        {/* How to apply */}
        <SectionHeading title="How to Apply" />
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--spacing-md)', marginBottom: 56
          }}
        >
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <div key={title} style={{ textAlign: 'center', padding: '0 8px' }}>
              <div
                style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px', position: 'relative', boxShadow: '0 6px 14px rgba(28,113,157,0.25)'
                }}
              >
                <Icon size={20} />
                <span
                  style={{
                    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                    background: 'var(--color-gold)', color: 'var(--color-primary-dark)', fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff'
                  }}
                >
                  {i + 1}
                </span>
              </div>
              <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{text}</p>
            </div>
          ))}
        </div>

        {/* Open positions */}
        <div id="open-positions" style={{ scrollMarginTop: 20 }}>
          <h2 style={{ textAlign: 'center', color: 'var(--color-primary-dark)', marginBottom: 10 }}>
            Open Positions
          </h2>
          <span style={{
            display: 'block', width: 48, height: 4, borderRadius: 999, margin: '0 auto 18px',
            background: 'linear-gradient(90deg, var(--color-primary), var(--color-gold))'
          }} />
          {!loading && !loadError && (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>{`Showing ${filtered.length} of ${vacancies.length} open position${vacancies.length === 1 ? '' : 's'}`}</span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => { setTitleSearch(''); setDeptSearch(''); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                    color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0
                  }}
                >
                  <X size={14} /> Clear filters
                </button>
              )}
            </p>
          )}

          {loading && <LoadingState label="Loading open vacancies..." />}

          {!loading && loadError && (
            <div style={{ textAlign: 'center', padding: '32px 20px' }}>
              <AlertTriangle size={28} color="var(--color-warning)" style={{ marginBottom: 10 }} />
              <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>
                We couldn&rsquo;t load open positions right now. Please check your connection and try again.
              </p>
              <Button variant="secondary" onClick={loadVacancies} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RotateCw size={15} /> Retry
              </Button>
            </div>
          )}

          {!loading && !loadError && filtered.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>No open vacancies match your search.</p>
          )}
          {!loading && !loadError && filtered.length > 0 && (
            <div
              style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 'var(--spacing-md)', marginBottom: 56
              }}
            >
              {filtered.map((v) => {
                const closed = isClosed(v);
                return (
                <Card key={v.id} className="hover-lift" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {v.jobRef ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{v.jobRef}: </span> : null}
                    {v.title}
                    {v.readvertisedFromId != null && <span style={{ marginLeft: 8 }}><StatusBadge status="Readvertised" /></span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                    {v.department?.name && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MapPin size={14} /> {v.department.name}
                        <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Users size={14} /> {v.positionsRequired} vacancies
                        </span>
                      </span>
                    )}
                    {!closed && v.deadline && <ClosingBadge deadline={v.deadline} />}
                    {closed && v.deadline && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={14} /> Closed {new Date(v.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <span style={{ display: 'flex', gap: 6 }}>
                      {closed ? <StatusBadge status="Closed" /> : <StatusBadge status={v.status} />}
                    </span>
                  </div>
                  <Link to={`/jobs/${v.id}`} style={{ marginTop: 'auto', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                    View details
                  </Link>
                  {closed ? (
                    <Button
                      variant="secondary"
                      disabled={downloadingId === v.id}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      onClick={() => download(v)}
                    >
                      <Download size={16} /> {downloadingId === v.id ? 'Preparing PDF...' : 'Download Job Details'}
                    </Button>
                  ) : (
                    // /apply/:id is RequireCandidate-gated (see App.jsx) - an
                    // anonymous visitor is bounced to /login?returnTo=... and
                    // lands back here after signing in, same as clicking
                    // Apply from any other job listing in the app.
                    <Link to={`/apply/${v.id}`} style={{ textDecoration: 'none' }}>
                      <Button style={{ width: '100%' }}>Apply Now</Button>
                    </Link>
                  )}
                </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* FAQ */}
        <div id="faq" style={{ scrollMarginTop: 20, maxWidth: 680, margin: '64px auto 56px' }}>
          <SectionHeading
            title="Frequently Asked Questions"
            subtitle="Common questions about applying to UCAA - or use the chat assistant in the bottom-right corner."
          />
          <div>
            {FAQ_ITEMS.map((item, i) => (
              <FaqItem
                key={item.q}
                id={`faq-answer-${i}`}
                q={item.q}
                a={item.a}
                open={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)', marginTop: 20 }}>
            <ShieldAlert size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            Still have a question? Contact Head Office: {HEAD_OFFICE_CONTACTS.join(', ')}, or{' '}
            <a href="mailto:careers@caa.co.ug">careers@caa.co.ug</a>.
          </p>
        </div>
      </div>

      {/* Final CTA - bookends the hero: same rounded-icon-badge treatment
          and gold accent, so the page opens and closes on the same visual
          language instead of the hero being the only "designed" moment. */}
      <section style={{
        width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '52px 20px',
        background: 'linear-gradient(180deg, var(--color-primary-light), #fff)'
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52,
          borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
          color: '#fff', marginBottom: 16, boxShadow: '0 8px 18px rgba(28,113,157,0.25)'
        }}>
          <Plane size={22} />
        </div>
        <h2 style={{ color: 'var(--color-primary-dark)', margin: '0 0 8px' }}>Ready to take the next step?</h2>
        <p style={{ color: 'var(--color-text-muted)', margin: '0 0 20px' }}>
          Create your candidate account and start applying in minutes.
        </p>
        <Link to="/register" style={{ textDecoration: 'none' }}>
          <Button style={{ padding: '12px 24px', fontSize: 15 }}>
            Get started <ArrowRight size={16} />
          </Button>
        </Link>
      </section>

      {hiddenPrintArea}
      <FaqChatWidget />
    </div>
  );
}
