import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Search, MapPin, Users, Calendar, ArrowRight, ArrowDown, UserPlus, LogIn, Download,
  FileEdit, Send, ListChecks, ShieldCheck, TrendingUp, HeartHandshake, GraduationCap,
  AlertTriangle, RotateCw, X, Clock, ChevronDown, ShieldAlert, Briefcase, Building2, Plane, Flame, SlidersHorizontal, ArrowUpDown
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

const isClosingSoon = (v) => Boolean(v.deadline) && !isClosed(v) && daysUntil(v.deadline) <= 7;

// How many open positions the list shows before "Show all" - enough to
// fill the first screen of the panel without pushing the rest of the page
// (Why Us, How to Apply, FAQ) out of reach. Filtering always shows every
// match, since a visitor who searched wants all the results.
const INITIAL_VISIBLE = 6;

const CATEGORY_LABELS = {
  FullTime: 'Full-time',
  Contract: 'Contract',
  FixedTermContract: 'Fixed-term contract'
};

// Same 10 UCAA sites HRDashboard.jsx's own LOCATIONS constant lists
// (kept as an independent literal here rather than imported, since that
// file is staff-only and this is the public landing page) - 8 of the 10
// are aerodromes (Entebbe, Gulu, Jinja, Mbarara, Fort Portal, Arua,
// Soroti, Kidepo); the other 2 are head-office locations, not aerodromes.
// This is the fact behind the hero's trust line below - keep it in sync
// if that list changes.
const AERODROME_COUNT = 8;

// Hero "jump to" pills - shown once vacancies have loaded, capped so the
// row never grows unbounded with the number of directorates that happen
// to have an open role right now.
const MAX_HERO_DIRECTORATE_PILLS = 5;

// Lowest to highest - same order and labels as EssentialRequirementsBuilder.
// The "My qualification" filter keeps every vacancy whose minimum is at or
// below the level picked (and every vacancy with no stated minimum).
const EDUCATION_LEVELS = [
  { value: 'OLevel', label: 'O-Level' },
  { value: 'ALevel', label: 'A-Level' },
  { value: 'Certificate', label: 'Certificate' },
  { value: 'Diploma', label: 'Diploma' },
  { value: 'Bachelors', label: "Bachelor's / Degree" },
  { value: 'Postgraduate', label: 'Postgraduate' },
  { value: 'Masters', label: "Master's" },
  { value: 'PhD', label: 'PhD' }
];
const EDUCATION_RANK = Object.fromEntries(EDUCATION_LEVELS.map((l, i) => [l.value, i]));
const educationLabel = (value) => EDUCATION_LEVELS.find((l) => l.value === value)?.label || value;

// "My experience" - keeps vacancies asking for at most this many years.
const EXPERIENCE_OPTIONS = [
  { value: '0', label: 'No experience yet' },
  { value: '2', label: 'Up to 2 years' },
  { value: '5', label: 'Up to 5 years' },
  { value: '10', label: 'Up to 10 years' },
  { value: '99', label: 'More than 10 years' }
];

const SORT_OPTIONS = [
  { value: 'closing', label: 'Closing soonest' },
  { value: 'newest', label: 'Newest first' },
  { value: 'title', label: 'Job title (A-Z)' },
  { value: 'vacancies', label: 'Most vacancies' }
];

const EMPTY_FILTERS = {
  text: '', directorate: '', department: '', location: '', category: '',
  education: '', experience: '', closingSoon: false
};

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

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

// Compact figure for the Open Positions panel header - the counts live
// with the list they describe rather than in a separate strip above it.
function HeaderFigure({ value, label, icon: Icon, loading }) {
  const display = useCountUp(typeof value === 'number' ? value : 0, !loading);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="home-figure__icon" style={{
        width: 36, height: 36, borderRadius: '50%', background: 'var(--color-primary-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        <Icon size={17} color="var(--color-primary)" />
      </span>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary-dark)', lineHeight: 1.1 }}>
          {loading ? '—' : display}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
      </div>
    </div>
  );
}

// Centered heading with a short two-tone accent bar underneath - repeated
// across the informational sections (Why Us, How to Apply, FAQ). Open
// Positions deliberately does NOT use it: that section is the page's main
// job and gets its own left-aligned panel header so it never reads as just
// another stacked section.
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

const metaItemStyle = { display: 'inline-flex', alignItems: 'center', gap: 5 };

// One vacancy as a scannable row: what the job is on the left, when it
// closes in the middle, what to do about it on the right. Wraps into a
// stacked card on narrow screens via flex-wrap. The left edge color is
// the at-a-glance urgency cue (blue open, amber closing within a week,
// grey closed).
function PositionRow({ v, onDownload, downloading }) {
  const closed = isClosed(v);
  const urgent = isClosingSoon(v);
  const edge = closed ? 'var(--color-border)' : urgent ? 'var(--color-warning)' : 'var(--color-primary)';
  return (
    <li
      className="position-row"
      style={{
        listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px',
        padding: '16px 18px', background: closed ? 'var(--color-bg-subtle)' : '#fff',
        border: '1px solid var(--color-border)', borderLeft: `4px solid ${edge}`, borderRadius: 'var(--radius)'
      }}
    >
      <div style={{ flex: '1 1 300px', minWidth: 0 }}>
        {v.jobRef && (
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
            {v.jobRef}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <Link
            to={`/jobs/${v.id}`}
            style={{ fontSize: 16.5, fontWeight: 700, color: closed ? 'var(--color-text-muted)' : 'var(--color-primary-dark)', textDecoration: 'none' }}
          >
            {v.title}
          </Link>
          {v.readvertisedFromId != null && <StatusBadge status="Readvertised" />}
          {!closed && v.status && v.status !== 'Open' && <StatusBadge status={v.status} />}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {v.department?.name && <span style={metaItemStyle}><Building2 size={14} /> {v.department.name}</span>}
          {v.location && <span style={metaItemStyle}><MapPin size={14} /> {v.location}</span>}
          <span style={metaItemStyle}><Users size={14} /> {v.positionsRequired} {v.positionsRequired === 1 ? 'vacancy' : 'vacancies'}</span>
          {CATEGORY_LABELS[v.employmentCategory] && (
            <span style={metaItemStyle}><Briefcase size={14} /> {CATEGORY_LABELS[v.employmentCategory]}</span>
          )}
          {v.minimumEducationLevel && (
            <span style={metaItemStyle}><GraduationCap size={14} /> Min. {educationLabel(v.minimumEducationLevel)}</span>
          )}
          {v.minimumExperienceYears > 0 && (
            <span style={metaItemStyle}><TrendingUp size={14} /> {v.minimumExperienceYears}+ yrs experience</span>
          )}
        </div>
      </div>

      <div className="position-row__deadline" style={{ flex: '0 0 auto', minWidth: 150, fontSize: 13 }}>
        {closed ? (
          <span style={{ ...metaItemStyle, color: 'var(--color-text-muted)' }}>
            <Calendar size={14} /> Closed {new Date(v.deadline).toLocaleDateString()}
          </span>
        ) : v.deadline ? (
          <ClosingBadge deadline={v.deadline} />
        ) : (
          <span style={{ color: 'var(--color-text-muted)' }}>Open until filled</span>
        )}
      </div>

      <div className="position-row__actions" style={{ flex: '0 0 auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link to={`/jobs/${v.id}`} style={{ textDecoration: 'none' }}>
          <Button variant="secondary">View details</Button>
        </Link>
        {closed ? (
          <Button variant="ghost" disabled={downloading} onClick={() => onDownload(v)}>
            <Download size={15} /> {downloading ? 'Preparing PDF...' : 'Download'}
          </Button>
        ) : (
          // /apply/:id is RequireCandidate-gated (see App.jsx) - an
          // anonymous visitor is bounced to /login?returnTo=... and
          // lands back here after signing in, same as clicking
          // Apply from any other job listing in the app.
          <Link to={`/apply/${v.id}`} style={{ textDecoration: 'none' }}>
            <Button style={{ fontWeight: 700 }}>Apply Now <ArrowRight size={15} /></Button>
          </Link>
        )}
      </div>
    </li>
  );
}

const fieldStyle = {
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-input)',
  padding: '10px 12px', fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)', minWidth: 0
};

// On/off filter button (Closing this week, More filters) - tinted in the
// given color while active.
const toggleStyle = (active, color, tint) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto', cursor: 'pointer',
  padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
  border: `1px solid ${active ? color : 'var(--color-border)'}`,
  background: active ? tint : '#fff',
  color: active ? color : 'var(--color-text)'
});

function FilterSelect({ label, allLabel, value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      style={{
        ...fieldStyle, flex: '1 1 180px',
        color: value ? 'var(--color-text)' : 'var(--color-text-muted)',
        borderColor: value ? 'var(--color-primary)' : 'var(--color-border)'
      }}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// Guest-only landing page (see App.jsx - registered as a full-bleed
// sibling route, not under PaddedLayout, so this hero can run edge to
// edge like Register/CandidateLogin do). A signed-in candidate is routed
// straight to /dashboard instead - see Navbar.jsx's logo link and
// ProtectedRoute usage elsewhere - so everything here can safely assume
// an anonymous visitor: the CTAs are "create an account" / "sign in",
// never "go to my dashboard".
//
// Layout priority: the Open Positions panel sits directly under the hero
// (overlapping its bottom edge) so it's visible on first load, with its
// own search/filter toolbar. The informational sections follow it, and a
// floating "Open positions" pill brings a visitor back from further down.
export default function Home() {
  const [vacancies, setVacancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('closing');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [showJumpPill, setShowJumpPill] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const { download, hiddenPrintArea, downloadingId } = useVacancyPdfDownload();
  const location = useLocation();
  const panelRef = useRef(null);

  const loadVacancies = () => {
    setLoading(true);
    setLoadError(false);
    client.get('/api/vacancies')
      // Anything but an array (e.g. an HTML page from a misrouted /api) is a
      // load error, not a crash in every list operation below.
      .then((res) => {
        if (!Array.isArray(res.data)) throw new Error('Unexpected vacancies response');
        setVacancies(res.data);
      })
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

  // Floating "back to open positions" pill: shown only once the visitor
  // has scrolled PAST the panel (it's out of view and above the viewport),
  // not while they're still in the hero above it.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setShowJumpPill(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Built from whatever vacancies actually loaded, not a separate lookup
  // call - there's no standalone "list of departments with open roles"
  // endpoint, and deriving it here means it can never list a department
  // with zero open positions.
  // Every option list is built from the vacancies that actually loaded,
  // so a dropdown never offers a directorate/location/type with no roles.
  // Departments narrow to the chosen directorate.
  const options = useMemo(() => ({
    directorates: uniqueSorted(vacancies.map((v) => v.department?.directorate?.name)),
    departments: uniqueSorted(vacancies
      .filter((v) => !filters.directorate || v.department?.directorate?.name === filters.directorate)
      .map((v) => v.department?.name)),
    locations: uniqueSorted(vacancies.map((v) => v.location?.trim())),
    categories: Object.keys(CATEGORY_LABELS).filter((c) => vacancies.some((v) => v.employmentCategory === c)),
    hasEducation: vacancies.some((v) => v.minimumEducationLevel),
    hasExperience: vacancies.some((v) => v.minimumExperienceYears > 0)
  }), [vacancies, filters.directorate]);

  const setFilter = (key, value) => setFilters((f) => {
    const next = { ...f, [key]: value };
    // A department from another directorate would silently match nothing.
    if (key === 'directorate') next.department = '';
    return next;
  });
  const clearFilters = () => setFilters(EMPTY_FILTERS);

  // Chips for every active filter, so the visitor can see (and undo)
  // exactly what's narrowing the list - including filters in the
  // collapsed "More filters" row.
  const activeChips = [
    filters.text.trim() && { key: 'text', label: `"${filters.text.trim()}"` },
    filters.directorate && { key: 'directorate', label: filters.directorate },
    filters.department && { key: 'department', label: filters.department },
    filters.location && { key: 'location', label: filters.location },
    filters.category && { key: 'category', label: CATEGORY_LABELS[filters.category] },
    filters.education && { key: 'education', label: `Qualification: ${educationLabel(filters.education)}` },
    filters.experience && { key: 'experience', label: EXPERIENCE_OPTIONS.find((o) => o.value === filters.experience)?.label },
    filters.closingSoon && { key: 'closingSoon', label: 'Closing this week' }
  ].filter(Boolean);
  const hasActiveFilters = activeChips.length > 0;
  const moreFiltersActive = ['location', 'category', 'education', 'experience'].filter((k) => filters[k]).length;

  // Open and closed vacancies are split rather than one sorted list, so a
  // closed role never sits in the same run as the ones a visitor can act on.
  const { openMatches, closedMatches } = useMemo(() => {
    const text = filters.text.trim().toLowerCase();
    const matches = vacancies.filter((v) =>
      (!text || [v.title, v.jobRef, v.department?.name, v.location]
        .some((field) => (field || '').toLowerCase().includes(text))) &&
      (!filters.directorate || v.department?.directorate?.name === filters.directorate) &&
      (!filters.department || v.department?.name === filters.department) &&
      (!filters.location || v.location?.trim() === filters.location) &&
      (!filters.category || v.employmentCategory === filters.category) &&
      (!filters.education || !v.minimumEducationLevel ||
        EDUCATION_RANK[v.minimumEducationLevel] <= EDUCATION_RANK[filters.education]) &&
      (!filters.experience || (v.minimumExperienceYears || 0) <= Number(filters.experience))
    );
    const byDeadline = (a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    };
    const comparators = {
      // Soonest-closing first (the most actionable thing for a visitor to
      // see), open-ended vacancies after all dated ones.
      closing: byDeadline,
      newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title),
      vacancies: (a, b) => (b.positionsRequired || 0) - (a.positionsRequired || 0) || byDeadline(a, b)
    };
    const open = matches
      .filter((v) => !isClosed(v) && (!filters.closingSoon || isClosingSoon(v)))
      .sort(comparators[sortBy] || byDeadline);
    const closed = filters.closingSoon ? [] : matches
      .filter(isClosed)
      .sort((a, b) => new Date(b.deadline) - new Date(a.deadline));
    return { openMatches: open, closedMatches: closed };
  }, [vacancies, filters, sortBy]);

  const openVacancies = useMemo(() => vacancies.filter((v) => !isClosed(v)), [vacancies]);
  const closingSoonCount = useMemo(() => openVacancies.filter(isClosingSoon).length, [openVacancies]);
  const departmentCount = useMemo(
    () => new Set(openVacancies.map((v) => v.department?.name).filter(Boolean)).size,
    [openVacancies]
  );
  const positionsCount = useMemo(
    () => openVacancies.reduce((sum, v) => sum + (v.positionsRequired || 0), 0),
    [openVacancies]
  );

  const visibleOpen = showAll || hasActiveFilters ? openMatches : openMatches.slice(0, INITIAL_VISIBLE);
  const hiddenCount = openMatches.length - visibleOpen.length;

  const scrollToPositions = () => {
    document.getElementById('open-positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Hero "jump to" pills (a directorate, or "closing this week") - starts
  // from a clean EMPTY_FILTERS rather than merging into whatever's already
  // set, so a hero click always means "show me exactly this," not "narrow
  // my existing search further" (the visitor hasn't touched the panel's
  // own filters yet in the common case of landing straight on the hero).
  const jumpToCategory = (patch) => {
    setFilters({ ...EMPTY_FILTERS, ...patch });
    scrollToPositions();
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Hero */}
      <section
        className="home-hero"
        style={{
          width: '100%', boxSizing: 'border-box', position: 'relative', overflow: 'hidden',
          background: `linear-gradient(160deg, ${ucaa.blue} 0%, ${ucaa.navy} 100%)`,
          color: '#fff', padding: '48px 20px 104px'
        }}
      >
        {/* Purely decorative depth - two soft blurred orbs (brand blue-light
            and the gold accent) sitting behind the content. aria-hidden and
            pointer-events:none since they carry no information and must
            never intercept clicks/taps meant for the buttons above them.
            Clipped by the section's own overflow:hidden. */}
        <div aria-hidden="true" style={{
          position: 'absolute', top: -80, right: '8%', width: 280, height: 280, borderRadius: '50%',
          background: 'var(--color-gold)', opacity: 0.18, filter: 'blur(70px)', pointerEvents: 'none'
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', bottom: -100, left: '5%', width: 320, height: 320, borderRadius: '50%',
          background: '#fff', opacity: 0.08, filter: 'blur(80px)', pointerEvents: 'none'
        }} />

        {/* Decorative flight path - a static dashed curve plus a small
            plane drifting along an approximated arc (a handful of
            transform keyframes, not SVG motion-path, for broader browser
            support). Reads as "aviation" rather than a generic gradient;
            the animation pauses under prefers-reduced-motion (theme.css).
            Hidden on phones - not enough hero height to read as a curve. */}
        <svg aria-hidden="true" className="home-flightpath-svg" viewBox="0 0 900 300" preserveAspectRatio="none" style={{
          position: 'absolute', top: 6, left: 0, width: '100%', height: '65%', opacity: 0.3, pointerEvents: 'none'
        }}>
          <path d="M-20,220 C200,260 350,40 500,90 S780,40 940,-10" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" />
        </svg>
        <Plane aria-hidden="true" size={20} color="var(--color-gold)" className="home-flightpath-plane" style={{ position: 'absolute', top: '20%', left: 0, pointerEvents: 'none' }} />

        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <span
            className="home-hero__logo"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 56, height: 56, borderRadius: 14, background: '#fff', padding: 8,
              marginBottom: 18, boxSizing: 'border-box'
            }}
          >
            <img src={ucaaLogo} alt="UCAA logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </span>

          <h1 className="home-hero__title" style={{ fontSize: 'clamp(28px, 4.4vw, 42px)', fontWeight: 800, margin: '0 0 12px', lineHeight: 1.12, letterSpacing: -0.5 }}>
            Build Your Career in <span style={{ color: 'var(--color-gold)' }}>Aviation</span>
          </h1>
          <p className="home-hero__lead" style={{ fontSize: 15.5, opacity: 0.92, maxWidth: 600, margin: '0 auto 26px' }}>
            Join the Uganda Civil Aviation Authority and help keep Uganda&rsquo;s skies safe, connected,
            and open for business.
          </p>

          {/* Primary action is browsing jobs - the live count makes it a
              concrete invitation rather than a generic "Explore". Account
              actions sit beside it as secondary. */}
          <div className="home-hero__actions" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              onClick={scrollToPositions}
              className="btn-attention home-hero__primary"
              style={{
                padding: '13px 24px', fontSize: 15.5, fontWeight: 700,
                background: 'var(--color-gold)', color: 'var(--color-primary-dark)'
              }}
            >
              <Briefcase size={17} />
              {loading ? 'View open positions' : `View ${openVacancies.length} open position${openVacancies.length === 1 ? '' : 's'}`}
              <ArrowDown size={16} />
            </Button>
            <Link to="/register" className="home-hero__secondary" style={{ textDecoration: 'none' }}>
              <Button
                variant="ghost"
                style={{ padding: '13px 20px', fontSize: 15, color: '#fff', borderColor: 'rgba(255,255,255,0.55)' }}
              >
                <UserPlus size={16} /> Create an account
              </Button>
            </Link>
            <Link to="/login" className="home-hero__secondary" style={{ textDecoration: 'none' }}>
              <Button
                variant="ghost"
                style={{ padding: '13px 20px', fontSize: 15, color: '#fff', borderColor: 'rgba(255,255,255,0.55)' }}
              >
                <LogIn size={16} /> Sign in
              </Button>
            </Link>
          </div>

          {/* Trust strip - two facts a wary applicant actually checks
              before trusting a "government recruitment" site, reusing
              claims already made elsewhere (the fee line matches the FAQ's
              own answer verbatim) rather than inventing new copy. */}
          <div className="home-hero__trust" style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 22px',
            marginTop: 22, fontSize: 12.5, opacity: 0.85
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={14} color="var(--color-gold)" /> No application fees, ever
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plane size={14} color="var(--color-gold)" /> Uganda&rsquo;s aviation regulator &mdash; {AERODROME_COUNT} aerodromes nationwide
            </span>
          </div>

          {/* Quick jump - browse by directorate, or straight to whatever's
              closing soonest, without reading the whole list first. Built
              from the same directorate list and closingSoonCount the panel
              below already derives from the loaded vacancies, so it only
              ever offers a category that actually has an open role right
              now. Hidden until that data has loaded, to avoid a flash of
              an empty row. */}
          {!loading && (closingSoonCount > 0 || options.directorates.length > 0) && (
            <div className="home-hero__quickjump" style={{
              display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 20
            }}>
              <span style={{ fontSize: 12.5, opacity: 0.75 }}>Jump to:</span>
              {closingSoonCount > 0 && (
                <button type="button" className="home-hero__pill" onClick={() => jumpToCategory({ closingSoon: true })}>
                  <Flame size={13} /> Closing this week ({closingSoonCount})
                </button>
              )}
              {options.directorates.slice(0, MAX_HERO_DIRECTORATE_PILLS).map((d) => (
                <button key={d} type="button" className="home-hero__pill" onClick={() => jumpToCategory({ directorate: d })}>
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Wave divider - a soft curve into the page background instead of
            the hero's gradient ending in a hard straight edge. The Open
            Positions panel below overlaps it (negative margin + z-index). */}
        <svg aria-hidden="true" viewBox="0 0 1440 60" preserveAspectRatio="none"
          style={{ display: 'block', width: '100%', height: 48, position: 'absolute', bottom: 0, left: 0 }}>
          <path d="M0,32 C320,64 1120,0 1440,28 L1440,60 L0,60 Z" fill="var(--color-bg)" />
        </svg>
      </section>

      {/* Open positions - the page's main job, so it's an elevated panel
          directly under the hero rather than a section after the
          informational content. */}
      <section
        id="open-positions"
        className="home-panel-wrap"
        ref={panelRef}
        aria-labelledby="open-positions-title"
        style={{
          maxWidth: 1080, margin: '-64px auto 0', padding: '0 16px', position: 'relative', zIndex: 1,
          scrollMarginTop: 'calc(var(--navbar-height) + 12px)', boxSizing: 'border-box'
        }}
      >
        <div className="home-panel" style={{
          background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
          borderTop: '5px solid var(--color-gold)', boxShadow: '0 16px 40px rgba(20,24,28,0.14)',
          padding: 'clamp(18px, 3vw, 28px)'
        }}>
          {/* Panel header: title + live counts */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
                letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 4
              }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)' }} />
                Now hiring
              </div>
              <h2 id="open-positions-title" style={{ margin: 0, color: 'var(--color-primary-dark)', fontSize: 26 }}>
                Open Positions
              </h2>
            </div>
            <div className="home-figures" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
              <HeaderFigure value={openVacancies.length} loading={loading} icon={Briefcase} label="Open positions" />
              <HeaderFigure value={departmentCount} loading={loading} icon={Building2} label="Departments hiring" />
              <HeaderFigure value={positionsCount} loading={loading} icon={Users} label="Vacancies available" />
            </div>
          </div>

          {/* Toolbar: filters apply live as the visitor types/selects. The
              first row holds the filters most visitors use; the rest sit
              behind "More filters" so the panel stays compact. */}
          <div
            role="search"
            className="home-toolbar"
            style={{
              display: 'flex', flexDirection: 'column', gap: 10, padding: 12, marginBottom: 12,
              background: 'var(--color-primary-light)', borderRadius: 'var(--radius)'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ position: 'relative', flex: '2 1 240px', minWidth: 0 }}>
                <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="search"
                  placeholder="Search title, reference, department or location..."
                  aria-label="Search by job title, reference, department or location"
                  value={filters.text}
                  onChange={(e) => setFilter('text', e.target.value)}
                  style={{ ...fieldStyle, width: '100%', paddingLeft: 36, boxSizing: 'border-box' }}
                />
              </div>
              {options.directorates.length > 0 && (
                <FilterSelect
                  label="Directorate" allLabel="All directorates"
                  value={filters.directorate} onChange={(v) => setFilter('directorate', v)}
                  options={options.directorates.map((d) => ({ value: d, label: d }))}
                />
              )}
              <FilterSelect
                label="Department" allLabel="All departments"
                value={filters.department} onChange={(v) => setFilter('department', v)}
                options={options.departments.map((d) => ({ value: d, label: d }))}
              />
              <button
                type="button"
                aria-expanded={showMoreFilters}
                aria-controls="more-filters"
                onClick={() => setShowMoreFilters((s) => !s)}
                style={{
                  ...toggleStyle(showMoreFilters || moreFiltersActive > 0, 'var(--color-primary)', 'var(--color-primary-light)')
                }}
              >
                <SlidersHorizontal size={15} />
                More filters{moreFiltersActive > 0 ? ` (${moreFiltersActive})` : ''}
                <ChevronDown size={15} style={{ transition: 'transform 0.15s ease', transform: showMoreFilters ? 'rotate(180deg)' : 'none' }} />
              </button>
            </div>

            {showMoreFilters && (
              <div id="more-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {options.locations.length > 0 && (
                  <FilterSelect
                    label="Location" allLabel="Any location"
                    value={filters.location} onChange={(v) => setFilter('location', v)}
                    options={options.locations.map((l) => ({ value: l, label: l }))}
                  />
                )}
                {options.categories.length > 0 && (
                  <FilterSelect
                    label="Employment type" allLabel="Any employment type"
                    value={filters.category} onChange={(v) => setFilter('category', v)}
                    options={options.categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
                  />
                )}
                {options.hasEducation && (
                  <FilterSelect
                    label="My highest qualification" allLabel="My highest qualification: any"
                    value={filters.education} onChange={(v) => setFilter('education', v)}
                    options={EDUCATION_LEVELS}
                  />
                )}
                {options.hasExperience && (
                  <FilterSelect
                    label="My experience" allLabel="My experience: any"
                    value={filters.experience} onChange={(v) => setFilter('experience', v)}
                    options={EXPERIENCE_OPTIONS}
                  />
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              {closingSoonCount > 0 && (
                <button
                  type="button"
                  aria-pressed={filters.closingSoon}
                  onClick={() => setFilter('closingSoon', !filters.closingSoon)}
                  style={toggleStyle(filters.closingSoon, 'var(--color-warning)', 'var(--color-warning-light)')}
                >
                  <Flame size={15} color="var(--color-warning)" /> Closing this week ({closingSoonCount})
                </button>
              )}
              <label className="home-sort" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 13, color: 'var(--color-text-muted)' }}>
                <ArrowUpDown size={14} /> <span className="home-sort-label">Sort by</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{ ...fieldStyle, padding: '7px 10px', fontSize: 13 }}
                >
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          {!loading && !loadError && (
            <div className="home-chips" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              <span aria-live="polite" style={{ marginRight: 4 }}>
                {hasActiveFilters
                  ? `${openMatches.length} matching open position${openMatches.length === 1 ? '' : 's'}`
                  : `${openMatches.length} open position${openMatches.length === 1 ? '' : 's'}`}
              </span>
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFilter(chip.key, EMPTY_FILTERS[chip.key])}
                  aria-label={`Remove filter ${chip.label}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 10px', borderRadius: 999,
                    border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)',
                    fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer'
                  }}
                >
                  {chip.label} <X size={13} color="var(--color-text-muted)" />
                </button>
              ))}
              {activeChips.length > 1 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                    color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0
                  }}
                >
                  Clear all
                </button>
              )}
            </div>
          )}

          {loading && <LoadingState label="Loading open vacancies..." />}

          {!loading && loadError && (
            <div style={{ textAlign: 'center', padding: '32px 20px' }}>
              <AlertTriangle size={28} color="var(--color-warning)" style={{ marginBottom: 10 }} />
              <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>
                We couldn&rsquo;t load open positions right now. Please check your connection and try again.
              </p>
              <Button variant="secondary" onClick={loadVacancies}>
                <RotateCw size={15} /> Retry
              </Button>
            </div>
          )}

          {!loading && !loadError && openMatches.length === 0 && (
            <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--color-text-muted)' }}>
              <Search size={24} style={{ marginBottom: 8 }} />
              <p style={{ margin: 0 }}>
                {hasActiveFilters
                  ? 'No open positions match your search.'
                  : 'There are no open positions right now. Create an account to be ready when new roles are advertised.'}
              </p>
            </div>
          )}

          {!loading && !loadError && visibleOpen.length > 0 && (
            <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleOpen.map((v) => (
                <PositionRow key={v.id} v={v} onDownload={download} downloading={downloadingId === v.id} />
              ))}
            </ul>
          )}

          {!loading && !loadError && hiddenCount > 0 && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setShowAll(true)} style={{ padding: '10px 20px', fontWeight: 600 }}>
                Show all {openMatches.length} open positions <ChevronDown size={16} />
              </Button>
            </div>
          )}

          {/* Recently closed - kept for reference (download the details) but
              collapsed and visually muted so it never competes with roles a
              visitor can still apply for. */}
          {!loading && !loadError && closedMatches.length > 0 && (
            <div style={{ marginTop: 20, borderTop: '1px dashed var(--color-border)', paddingTop: 14 }}>
              <button
                type="button"
                aria-expanded={showClosed}
                aria-controls="closed-positions"
                onClick={() => setShowClosed((s) => !s)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0,
                  color: 'var(--color-text-muted)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                }}
              >
                <ChevronDown size={16} style={{ transition: 'transform 0.15s ease', transform: showClosed ? 'rotate(180deg)' : 'none' }} />
                Recently closed ({closedMatches.length})
              </button>
              {showClosed && (
                <ul id="closed-positions" style={{ margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {closedMatches.map((v) => (
                    <PositionRow key={v.id} v={v} onDownload={download} downloading={downloadingId === v.id} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Informational sections - on a tinted band so they read as
          supporting content, separate from the positions panel above. */}
      <div className="home-info" style={{ background: 'var(--color-bg-subtle)', marginTop: 56 }}>
        <div className="home-info__inner" style={{ maxWidth: 1080, margin: '0 auto', padding: '56px 20px 8px', boxSizing: 'border-box' }}>
          {/* Why work with us */}
          <SectionHeading
            title="Why Build Your Career With Us"
            subtitle="A national regulator with a real mission, and a workplace that invests in the people behind it."
          />
          <div
            className="home-values"
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
            className="home-steps"
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--spacing-md)', marginBottom: 56
            }}
          >
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <div key={title} className="home-step" style={{ textAlign: 'center', padding: '0 8px' }}>
                <div
                  className="home-step__icon"
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
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 20px', boxSizing: 'border-box' }}>
        {/* FAQ */}
        <div id="faq" className="home-faq" style={{ scrollMarginTop: 'calc(var(--navbar-height) + 12px)', maxWidth: 680, margin: '56px auto 56px' }}>
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
      <section className="home-cta" style={{
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
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={scrollToPositions} style={{ padding: '12px 22px', fontSize: 15 }}>
            <Briefcase size={16} /> Browse open positions
          </Button>
          <Link to="/register" style={{ textDecoration: 'none' }}>
            <Button style={{ padding: '12px 24px', fontSize: 15 }}>
              Get started <ArrowRight size={16} />
            </Button>
          </Link>
        </div>
      </section>

      {/* Floating shortcut back to the list once the visitor has scrolled
          past it - bottom-left so it never collides with the FAQ chat
          widget in the bottom-right corner. */}
      {showJumpPill && !loading && (
        <button
          type="button"
          onClick={scrollToPositions}
          className="desktop-only"
          style={{
            position: 'fixed', left: 20, bottom: 'calc(var(--footer-height) + 16px)', zIndex: 200,
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 999,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            background: 'var(--color-gold)', color: 'var(--color-primary-dark)',
            boxShadow: '0 8px 20px rgba(20,24,28,0.22)'
          }}
        >
          <Briefcase size={16} /> Open positions ({openVacancies.length})
        </button>
      )}

      {hiddenPrintArea}
      <FaqChatWidget />
    </div>
  );
}
