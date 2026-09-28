import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, FileText, User, HelpCircle, LogIn } from 'lucide-react';

// Phone-only bottom navigation (hidden above 767px by the .mobile-only
// class in theme.css), the way a native app puts its main stops under the
// thumb. It replaces the Footer on phones, and on the candidate side it
// also replaces CandidateSidebar's floating menu button. Staff screens
// don't get one - App.jsx only mounts it on the guest/candidate site.
//
// `hash` items are Home.jsx anchors; Home's own hash-scroll effect does the
// scrolling once routed there.
const GUEST_TABS = [
  { label: 'Home', icon: Home, to: '/', match: (p, h) => p === '/' && h !== '#open-positions' && h !== '#faq' },
  { label: 'Jobs', icon: Search, to: '/#open-positions', match: (p, h) => (p === '/' && h === '#open-positions') || p.startsWith('/jobs/') },
  { label: 'Help', icon: HelpCircle, to: '/#faq', match: (p, h) => p === '/' && h === '#faq' },
  { label: 'Sign in', icon: LogIn, to: '/login', match: (p) => p === '/login' || p === '/register' }
];

const CANDIDATE_TABS = [
  { label: 'Home', icon: Home, to: '/dashboard', match: (p) => p === '/dashboard' },
  { label: 'Jobs', icon: Search, to: '/dashboard/jobs', match: (p) => p === '/dashboard/jobs' || p.startsWith('/jobs/') },
  { label: 'Applications', icon: FileText, to: '/dashboard/applications', match: (p) => p === '/dashboard/applications' },
  { label: 'Profile', icon: User, to: '/dashboard/profile', match: (p) => p === '/dashboard/profile' || p === '/profile/complete' }
];

export default function MobileTabBar({ signedIn }) {
  const { pathname, hash } = useLocation();
  const tabs = signedIn ? CANDIDATE_TABS : GUEST_TABS;

  return (
    <nav className="mobile-only mobile-tabbar" aria-label="Main">
      {tabs.map(({ label, icon: Icon, to, match }) => {
        const active = match(pathname, hash);
        return (
          <Link
            key={label}
            to={to}
            className={`mobile-tabbar__item${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              // A plain tab always opens at the top, like a native tab bar.
              // An anchor tab re-scrolls when tapped again (the hash doesn't
              // change, so Home's hash effect wouldn't fire).
              const anchor = to.split('#')[1];
              if (!anchor) window.scrollTo({ top: 0, behavior: active ? 'smooth' : 'auto' });
              else if (active) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            <Icon size={21} strokeWidth={active ? 2.4 : 2} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
