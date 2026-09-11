import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, MapPin, Users, Calendar, ArrowRight, UserPlus, LogIn,
  FileEdit, Send, ListChecks, ShieldCheck, TrendingUp, HeartHandshake, GraduationCap
} from 'lucide-react';
import client from '../models/apiClient';
import Button from '../components/Button';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import LoadingState from '../components/LoadingState';
import ucaaLogo from '../assets/ucaa-logo.png';

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

function Stat({ value, label }) {
  return (
    <div style={{ padding: '22px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary-dark)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
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
  const [titleSearch, setTitleSearch] = useState('');
  const [deptSearch, setDeptSearch] = useState('');

  useEffect(() => {
    client.get('/api/vacancies')
      .then((res) => setVacancies(res.data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const title = titleSearch.trim().toLowerCase();
    const dept = deptSearch.trim().toLowerCase();
    return vacancies.filter((v) =>
      (!title || v.title.toLowerCase().includes(title)) &&
      (!dept || (v.department?.name || '').toLowerCase().includes(dept))
    );
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
          width: '100%', boxSizing: 'border-box',
          background: `linear-gradient(160deg, ${ucaa.blue} 0%, ${ucaa.navy} 100%)`,
          color: '#fff', padding: '64px 20px 88px'
        }}
      >
        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 60, height: 60, borderRadius: 14, background: '#fff', padding: 8,
              marginBottom: 20, boxSizing: 'border-box'
            }}
          >
            <img src={ucaaLogo} alt="UCAA logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </span>
          <h1 style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: '0 0 12px', lineHeight: 1.15 }}>
            Build Your Career in Aviation
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
              value={titleSearch}
              onChange={(e) => setTitleSearch(e.target.value)}
              style={{
                flex: '1 1 200px', border: 'none', padding: '10px 12px',
                fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)', minWidth: 0
              }}
            />
            <input
              placeholder="Department"
              value={deptSearch}
              onChange={(e) => setDeptSearch(e.target.value)}
              style={{
                flex: '1 1 150px', border: 'none', padding: '10px 12px',
                fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)', minWidth: 0
              }}
            />
            <Button type="submit" style={{ padding: '10px 18px' }}>
              <Search size={16} /> Find Jobs
            </Button>
          </form>
        </div>
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
          <Stat value={loading ? '—' : vacancies.length} label="Open positions" />
          <Stat value={loading ? '—' : departmentCount} label="Departments hiring" />
          <Stat value={loading ? '—' : positionsCount} label="Vacancies available" />
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '56px 20px 0', boxSizing: 'border-box' }}>
        {/* Why work with us */}
        <h2 style={{ textAlign: 'center', color: 'var(--color-primary-dark)', marginBottom: 4 }}>
          Why Build Your Career With Us
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', maxWidth: 560, margin: '0 auto' }}>
          A national regulator with a real mission, and a workplace that invests in the people behind it.
        </p>
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--spacing-md)', marginTop: 28, marginBottom: 56
          }}
        >
          {VALUES.map(({ icon: Icon, title, text }) => (
            <Card key={title} style={{ textAlign: 'center', marginBottom: 0 }}>
              <div
                style={{
                  width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary-light)',
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
        <h2 style={{ textAlign: 'center', color: 'var(--color-primary-dark)', marginBottom: 28 }}>
          How to Apply
        </h2>
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
                  width: 48, height: 48, borderRadius: '50%', background: 'var(--color-primary)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px', position: 'relative'
                }}
              >
                <Icon size={20} />
                <span
                  style={{
                    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                    background: 'var(--color-primary-dark)', fontSize: 11, fontWeight: 700,
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
          <h2 style={{ textAlign: 'center', color: 'var(--color-primary-dark)', marginBottom: 4 }}>
            Open Positions
          </h2>
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 24 }}>
            {loading
              ? 'Loading vacancies...'
              : `Showing ${filtered.length} of ${vacancies.length} open position${vacancies.length === 1 ? '' : 's'}`}
          </p>

          {loading && <LoadingState label="Loading open vacancies..." />}
          {!loading && filtered.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>No open vacancies match your search.</p>
          )}
          {!loading && filtered.length > 0 && (
            <div
              style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 'var(--spacing-md)', marginBottom: 56
              }}
            >
              {filtered.map((v) => (
                <Card key={v.id} style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {v.jobRef ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{v.jobRef}: </span> : null}
                    {v.title}
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
                    {v.deadline && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={14} /> Apply by {new Date(v.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <span><StatusBadge status={v.status} /></span>
                  </div>
                  {/* /apply/:id is RequireCandidate-gated (see App.jsx) - an
                      anonymous visitor is bounced to /login?returnTo=... and
                      lands back here after signing in, same as clicking
                      Apply from any other job listing in the app. */}
                  <Link to={`/apply/${v.id}`} style={{ marginTop: 'auto', textDecoration: 'none' }}>
                    <Button style={{ width: '100%' }}>Apply Now</Button>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Final CTA */}
      <section style={{ width: '100%', boxSizing: 'border-box', background: 'var(--color-primary-light)', padding: '48px 20px', textAlign: 'center' }}>
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
    </div>
  );
}
