import { Link, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// One config entry per route rendered inside App.jsx's PaddedLayout - the
// only place this component is mounted. `end: true` matching (see
// resolveTrail below) keeps a short path (e.g. "/hr") from also matching a
// longer one that starts with it (e.g. "/hr/vacancy/5"), so entry order
// here doesn't matter - every pattern matches only its own exact path.
//
// Each trail is root-to-current; the last entry is the current page
// (never linked). A "to" on an earlier entry is a real, reachable route -
// most staff pages don't nest under each other in the URL (HRSidebar's
// five stops are siblings, not parent/child), so "Home" (/hr/home) is used
// as a synthetic root for all of them purely to give every staff/candidate
// page at least one place a breadcrumb can send you back to, matching
// CandidateSidebar/HRSidebar's own labels for consistency.
const ROUTE_TRAILS = [
  { path: '/dashboard', trail: [{ label: 'Dashboard' }] },
  { path: '/dashboard/jobs', trail: [{ label: 'Dashboard', to: '/dashboard' }, { label: 'Find Jobs' }] },
  { path: '/dashboard/applications', trail: [{ label: 'Dashboard', to: '/dashboard' }, { label: 'My Applications' }] },
  { path: '/dashboard/profile', trail: [{ label: 'Dashboard', to: '/dashboard' }, { label: 'My Profile' }] },
  { path: '/profile/complete', trail: [{ label: 'Dashboard', to: '/dashboard' }, { label: 'Complete Your Profile' }] },

  { path: '/confirm-email', trail: [{ label: 'Candidate Login', to: '/login' }, { label: 'Confirm Email' }] },
  { path: '/forgot-password', trail: [{ label: 'Candidate Login', to: '/login' }, { label: 'Forgot Password' }] },
  { path: '/reset-password', trail: [{ label: 'Candidate Login', to: '/login' }, { label: 'Reset Password' }] },

  { path: '/hr/home', trail: [{ label: 'Home' }] },
  { path: '/hr', trail: [{ label: 'Home', to: '/hr/home' }, { label: 'Vacancy Management' }] },
  { path: '/hr/departments', trail: [{ label: 'Home', to: '/hr/home' }, { label: 'Department Management' }] },
  { path: '/hr/staff-management', trail: [{ label: 'Home', to: '/hr/home' }, { label: 'Staff Management' }] },
  {
    path: '/hr/vacancy/:id',
    trail: [{ label: 'Home', to: '/hr/home' }, { label: 'Vacancy Management', to: '/hr' }, { label: 'Vacancy Details' }]
  },
  // Manager/Director's own root (see HRSidebar.jsx/Navbar.jsx) - these
  // don't nest under /hr/home the way the operational screens above do,
  // since Executive Overview is that tier's actual landing page.
  { path: '/hr/executive', trail: [{ label: 'Executive Overview' }] },
  { path: '/hr/approvals', trail: [{ label: 'Executive Overview', to: '/hr/executive' }, { label: 'Approvals Center' }] },

  { path: '/staff/forgot-password', trail: [{ label: 'Staff Login', to: '/staff/login' }, { label: 'Forgot Password' }] },
  { path: '/staff/reset-password', trail: [{ label: 'Staff Login', to: '/staff/login' }, { label: 'Reset Password' }] },

  { path: '/panel-score/:token', trail: [{ label: 'Interview Scoring' }] }
];

// Last-resort fallback for a path with no entry above (e.g. a new route
// added under PaddedLayout without updating this file) - splits the
// pathname into segments and title-cases each one, dropping anything that
// looks like a dynamic id (a bare number, or a long opaque token like a
// verification/panel-access token) rather than showing it as a label.
function fallbackTrail(pathname) {
  const looksLikeId = (s) => /^\d+$/.test(s) || s.length > 20;
  const labels = pathname.split('/').filter(Boolean).filter((s) => !looksLikeId(s))
    .map((s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  return labels.length > 0 ? labels.map((label) => ({ label })) : null;
}

function resolveTrail(pathname) {
  const matched = ROUTE_TRAILS.find((route) => matchPath({ path: route.path, end: true }, pathname));
  return matched ? matched.trail : fallbackTrail(pathname);
}

// Global - mounted once in App.jsx's PaddedLayout, above every routed
// page's own content, rather than each view rendering its own copy. Not
// rendered on the full-bleed sibling routes (Home/Register/Login/
// ApplyForm/StaffLogin) since those manage their own edge-to-edge layout
// and, in ApplyForm's case, already have their own step navigation
// (StepperRail) - a second nav strip there would be redundant.
export default function BreadcrumbNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const trail = resolveTrail(location.pathname);

  if (!trail) return null;

  return (
    <div
      style={{
        // Fixed, not just sticky - pinned directly under the (also fixed)
        // Navbar so it never scrolls away with the page content, same
        // pattern as Navbar.jsx/Footer.jsx themselves. A known, fixed
        // height (--breadcrumb-height, theme.css) is what lets
        // App.jsx's PaddedLayout reserve exactly enough top padding so
        // routed content never renders underneath it.
        position: 'fixed', top: 'var(--navbar-height)', left: 0, right: 0, zIndex: 90,
        height: 'var(--breadcrumb-height)', boxSizing: 'border-box',
        background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'nowrap', overflowX: 'auto',
        padding: '0 20px'
      }}
    >
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Go back"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, padding: 0, flexShrink: 0
        }}
      >
        <ChevronLeft size={15} /> Back
      </button>

      <span style={{ width: 1, height: 16, background: 'var(--color-border)', flexShrink: 0 }} />

      <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', fontSize: 13, whiteSpace: 'nowrap' }}>
        {trail.map((crumb, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {i > 0 && <ChevronRight size={13} color="var(--color-text-muted)" />}
            {crumb.to ? (
              <Link to={crumb.to} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{crumb.label}</Link>
            ) : (
              <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
    </div>
  );
}
