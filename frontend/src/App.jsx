import React, { useEffect, useLayoutEffect } from "react";
import { Routes, Route, Outlet, Navigate, useLocation } from "react-router-dom";
import { rememberSourceFromUrl } from "./utils/applicationSources";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import BreadcrumbNav from "./components/BreadcrumbNav";
import MobileTabBar from "./components/MobileTabBar";
import { useAuth } from "./models/AuthContext";
import { isStaffPort } from "./staffPort";
import { isInternalPort } from "./internalPort";
import InternalSignIn from "./views/careers/InternalSignIn";
import InternalWelcome from "./views/careers/InternalWelcome";
import CareerHome from "./views/careers/CareerHome";
import CareerJobs from "./views/careers/CareerJobs";
import CareerJob from "./views/careers/CareerJob";
import CareerApply from "./views/careers/CareerApply";
import CareerApplications from "./views/careers/CareerApplications";
import CareerProfile from "./views/careers/CareerProfile";

import Home from "./views/Home";
import Register from "./views/Register";
import ConfirmEmail from "./views/ConfirmEmail";
import CandidateLogin from "./views/CandidateLogin";
import ForgotPassword from "./views/ForgotPassword";
import ResetPassword from "./views/ResetPassword";
import ProfileCompletePage from "./views/ProfileCompletePage";
import JobDetails from "./views/JobDetails";
import StaffLogin from "./views/StaffLogin";
import Inbox from "./views/Inbox";
import RecruitmentDashboard from "./views/RecruitmentDashboard";
import OffersAndHires from "./views/OffersAndHires";
import CandidateSearch from "./views/CandidateSearch";
import HRDashboard from "./views/HRDashboard";
import ApplicationManagement from "./views/ApplicationManagement";
import DepartmentAdmin from "./views/DepartmentAdmin";
import StaffManagement from "./views/StaffManagement";
import StaffAccounts from "./views/StaffAccounts";
import DocumentTemplates from "./views/DocumentTemplates";
import SettingsAndData from "./views/SettingsAndData";
import VacancyWorkspace from "./views/VacancyWorkspace";
import CreateVacancyListing from "./views/CreateVacancyListing";
import ShortlistPanelAccess from "./views/ShortlistPanelAccess";
import InterviewHub from "./views/InterviewHub";
import PrivacyNotice from "./views/PrivacyNotice";
import { RequireCandidate, RequireStaff, RequireSystemAdmin, RequireSystemAdminOrRole, RequireStaffPort, GuestPortGate, InternalPortGate, RequireInternalCandidate } from "./components/ProtectedRoute";

// Padding lives here, not on the app shell - Navbar/Footer render outside
// this entirely, full width with no inset. Only routes nested under this
// layout (plain views with no background/layout of their own) get a
// gutter; the self-contained full-bleed pages (login/register/apply,
// registered as siblings below) already manage their own edge-to-edge
// background and would get a second, unwanted inset if wrapped here too.
function PaddedLayout() {
  return (
    // BreadcrumbNav is position:fixed (pinned under the Navbar, see its own
    // comment) - the extra top padding here is what reserves exactly its
    // height so routed content never renders underneath it. Only this
    // layout pads by --breadcrumb-height, not the outer wrapper below,
    // since the full-bleed sibling routes never render the bar at all.
    <div className="padded-layout" style={{ padding: 20, paddingTop: 'calc(20px + var(--breadcrumb-height))' }}>
      <BreadcrumbNav />
      <Outlet />
    </div>
  );
}

// Focused flows where a phone shows no tab bar, the way an app hides its
// tabs inside a multi-step task: the apply wizard, first-time profile
// completion, and a shortlisting committee member's private link.
const NO_TABBAR_PATHS = [/^\/apply\//, /^\/profile\/complete/, /^\/shortlist-panel\//];

// The public site's signed-in candidate area (views/careers, the same pages
// as Internal Careers) wears .careers-ui (theme.css): the site's own colours
// with the sidebar layout, and no breadcrumb strip or footer.
const CAREER_PATHS = [/^\/dashboard(\/|$)/, /^\/jobs\//, /^\/apply\//];

// A job advert: a signed-in applicant gets it in their own area, with "Your
// fit" and Apply; a guest gets the public page.
function JobPage() {
  const { candidate } = useAuth();
  return candidate ? <CareerJob /> : <JobDetails />;
}

export default function App() {
  const { candidate, staff } = useAuth();
  const { pathname, search } = useLocation();
  // A link that says where the advert was seen (?source=LinkedIn) - kept for the Submit step.
  useEffect(() => { rememberSourceFromUrl(search); }, [search]);
  // Phones only (theme.css hides it above 767px). The guest/candidate site
  // gets the bottom tab bar; staff screens keep their sidebar drawer.
  // Internal Careers (internalPort.js) uses the sidebar, like staff.
  const showTabBar = !staff && !isStaffPort() && !isInternalPort() && !NO_TABBAR_PATHS.some((re) => re.test(pathname));
  // The quieter staff workspace look (theme.css .staff-ui): on <html> so
  // modals and anything else outside the app shell pick it up as well.
  // Internal Careers wears it too: UCAA employees get the same corporate look.
  const staffUi = Boolean(staff) || isStaffPort() || isInternalPort();
  const careersUi = !staffUi && Boolean(candidate) && CAREER_PATHS.some((re) => re.test(pathname));
  // Before paint, so a staff page never flashes the candidate look.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("staff-ui", staffUi);
    document.documentElement.classList.toggle("careers-ui", careersUi);
  }, [staffUi, careersUi]);

  return (
    // app-shell / with-tabbar drive the phone-only layout in theme.css
    // (compact app bar, no footer, --footer-height = tab bar height).
    <div className={`app-shell${showTabBar ? " with-tabbar" : ""}`} style={{ fontFamily: "sans-serif", width: "100%" }}>
      <Navbar />

      {/* Navbar and Footer are position:fixed (pinned to the viewport on
          scroll) - this padding is what keeps routed content from
          rendering underneath either of them. Applied once here rather
          than in every view, including the full-bleed ones registered as
          siblings below (their own edge-to-edge backgrounds still start
          right under the navbar, not behind it). */}
      <div style={{ paddingTop: "var(--navbar-height)", paddingBottom: "var(--footer-height)", boxSizing: "border-box" }}>
      <Routes>
        {/* Staff-side and public routes - never gated by GuestPortGate.
            The unauthenticated staff entry points below are gated the
            opposite way instead (RequireStaffPort: staff port only). */}
        <Route element={<PaddedLayout />}>
          {/* Public - candidates consent to it when applying (FR-ATS-038). */}
          <Route path="/privacy" element={<PrivacyNotice />} />
          {/* The staff workspace: every role lands on the Inbox; the old
              home, executive overview and approvals pages lead there. */}
          <Route
            path="/hr/inbox"
            element={
              <RequireStaff minRole="HR_Officer">
                <Inbox />
              </RequireStaff>
            }
          />
          <Route path="/hr/home" element={<Navigate to="/hr/inbox" replace />} />
          <Route path="/hr/executive" element={<Navigate to="/hr/inbox" replace />} />
          <Route path="/hr/approvals" element={<Navigate to="/hr/inbox" replace />} />
          <Route
            path="/hr/offers"
            element={
              <RequireStaff minRole="HR_Officer">
                <OffersAndHires />
              </RequireStaff>
            }
          />
          <Route
            path="/hr"
            element={
              <RequireStaff minRole="HR_Officer">
                <HRDashboard />
              </RequireStaff>
            }
          />
          {/* Interview Hub - agenda, what needs attention, scorecards and
              the scheduler; replaces the old Interviews tab on /hr. */}
          <Route
            path="/hr/interviews"
            element={
              <RequireStaff minRole="HR_Officer">
                <InterviewHub />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/departments"
            element={
              <RequireStaff minRole="HR_Officer">
                <DepartmentAdmin />
              </RequireStaff>
            }
          />
          {/* Analytics and the recruitment dashboard are one page now. */}
          <Route path="/hr/analytics" element={<Navigate to="/hr/dashboard" replace />} />
          <Route path="/hr/analytics/recruitment" element={<Navigate to="/hr/dashboard" replace />} />
          <Route
            path="/hr/candidates"
            element={
              <RequireStaff minRole="HR_Officer">
                <CandidateSearch />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/dashboard"
            element={
              <RequireStaff minRole="Manager">
                <RecruitmentDashboard />
              </RequireStaff>
            }
          />
          {/* Combined Staff Accounts + Delegations page, replacing the two
              old standalone routes and their Navbar links - see
              StaffManagement.jsx and HRSidebar.jsx. Gated at the lower of
              the two original tiers; each section inside enforces its own
              original boundary. */}
          <Route
            path="/hr/staff-management"
            element={
              <RequireStaff minRole="Senior_HR_Officer">
                <StaffManagement />
              </RequireStaff>
            }
          />
          {/* Staff account administration - system administrators only,
              whatever HR role anyone holds (see StaffAccounts.jsx). */}
          <Route
            path="/hr/staff-accounts"
            element={
              <RequireSystemAdmin>
                <StaffAccounts />
              </RequireSystemAdmin>
            }
          />
          <Route
            path="/hr/settings"
            element={
              <RequireSystemAdminOrRole minRole="Manager">
                <SettingsAndData />
              </RequireSystemAdminOrRole>
            }
          />
          <Route
            path="/hr/templates"
            element={
              <RequireStaff minRole="HR_Officer">
                <DocumentTemplates />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/applications"
            element={
              <RequireStaff minRole="HR_Officer">
                <ApplicationManagement />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/vacancies/new"
            element={
              <RequireStaff minRole="HR_Officer">
                <CreateVacancyListing />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/vacancy/:id"
            element={
              <RequireStaff minRole="HR_Officer">
                <VacancyWorkspace />
              </RequireStaff>
            }
          />
          {/* Public - a shortlisting committee member's private link, no
              login, and not gated by port since that link always points at
              the guest origin (see backend/src/config/frontendUrl.js) anyway. */}
          <Route path="/shortlist-panel/:token" element={<ShortlistPanelAccess />} />
        </Route>
        {/* Internal Careers - UCAA employees, on its own port only
            (InternalPortGate; internalPort.js). Microsoft sign-in is the
            only way in; every other page needs an Internal candidate. */}
        <Route element={<InternalPortGate />}>
          <Route path="/careers/sign-in" element={<InternalSignIn />} />
          <Route element={<PaddedLayout />}>
            <Route path="/careers" element={<RequireInternalCandidate><CareerHome /></RequireInternalCandidate>} />
            <Route path="/careers/welcome" element={<RequireInternalCandidate><InternalWelcome /></RequireInternalCandidate>} />
            <Route path="/careers/vacancies" element={<RequireInternalCandidate><CareerJobs /></RequireInternalCandidate>} />
            <Route path="/careers/vacancies/:id" element={<RequireInternalCandidate><CareerJob /></RequireInternalCandidate>} />
            <Route path="/careers/apply/:vacancyId" element={<RequireInternalCandidate><CareerApply /></RequireInternalCandidate>} />
            <Route path="/careers/applications" element={<RequireInternalCandidate><CareerApplications /></RequireInternalCandidate>} />
            <Route path="/careers/profile" element={<RequireInternalCandidate><CareerProfile /></RequireInternalCandidate>} />
          </Route>
        </Route>
        <Route
          path="/staff/login"
          element={
            <RequireStaffPort>
              <StaffLogin />
            </RequireStaffPort>
          }
        />

        {/* Guest/candidate-side routes - all gated by GuestPortGate so none
            of them render from the staff-only port; a staff member opening
            any of these URLs there lands on staff login instead. */}
        <Route element={<GuestPortGate />}>
          <Route element={<PaddedLayout />}>
            {/* Public - no RequireCandidate. Reached from Home.jsx's "View
                details" link and directly shareable, since a guest should
                be able to read a full advert before creating an account. */}
            <Route path="/jobs/:id" element={<JobPage />} />
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/dashboard"
              element={
                <RequireCandidate>
                  <CareerHome />
                </RequireCandidate>
              }
            />
            <Route
              path="/dashboard/jobs"
              element={
                <RequireCandidate>
                  <CareerJobs />
                </RequireCandidate>
              }
            />
            <Route
              path="/dashboard/applications"
              element={
                <RequireCandidate>
                  <CareerApplications />
                </RequireCandidate>
              }
            />
            <Route
              path="/dashboard/profile"
              element={
                <RequireCandidate>
                  <CareerProfile />
                </RequireCandidate>
              }
            />
            <Route
              path="/apply/:vacancyId"
              element={
                <RequireCandidate>
                  <CareerApply />
                </RequireCandidate>
              }
            />
          </Route>

          {/* Full-bleed, self-contained pages - NOT wrapped in PaddedLayout.
              Each already renders its own edge-to-edge width:100% background
              (a full-viewport gradient card, or the wizard's own themed
              wrapper), so adding padding here would inset that background
              from the window edge - the exact bug this layout split avoids. */}
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<CandidateLogin />} />
          <Route
            path="/profile/complete"
            element={
              <RequireCandidate>
                <ProfileCompletePage />
              </RequireCandidate>
            }
          />
        </Route>

        {/* Internal Careers: an unknown address goes to its home rather than a blank page. */}
        {isInternalPort() && <Route path="*" element={<Navigate to="/careers" replace />} />}
      </Routes>
      </div>

      <Footer />
      {showTabBar && <MobileTabBar signedIn={Boolean(candidate)} />}
    </div>
  );
}
