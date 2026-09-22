import React from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import BreadcrumbNav from "./components/BreadcrumbNav";

import Home from "./views/Home";
import Register from "./views/Register";
import ConfirmEmail from "./views/ConfirmEmail";
import CandidateLogin from "./views/CandidateLogin";
import ForgotPassword from "./views/ForgotPassword";
import ResetPassword from "./views/ResetPassword";
import ProfileCompletePage from "./views/ProfileCompletePage";
import CandidateHome from "./views/CandidateHome";
import CandidateJobs from "./views/CandidateJobs";
import CandidateProfile from "./views/CandidateProfile";
import CandidateApplications from "./views/CandidateApplications";
import ApplyForm from "./views/ApplyForm";
import JobDetails from "./views/JobDetails";
import StaffLogin from "./views/StaffLogin";
import StaffForgotPassword from "./views/StaffForgotPassword";
import StaffResetPassword from "./views/StaffResetPassword";
import HRHome from "./views/HRHome";
import ExecutiveDashboard from "./views/ExecutiveDashboard";
import ApprovalsCenter from "./views/ApprovalsCenter";
import Analytics from "./views/Analytics";
import HRDashboard from "./views/HRDashboard";
import ApplicationManagement from "./views/ApplicationManagement";
import DepartmentAdmin from "./views/DepartmentAdmin";
import StaffManagement from "./views/StaffManagement";
import VacancyDetail from "./views/VacancyDetail";
import CreateVacancyListing from "./views/CreateVacancyListing";
import PanelScoreAccess from "./views/PanelScoreAccess";
import { RequireCandidate, RequireStaff, RequireStaffPort, GuestPortGate } from "./components/ProtectedRoute";

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
    <div style={{ padding: 20, paddingTop: 'calc(20px + var(--breadcrumb-height))' }}>
      <BreadcrumbNav />
      <Outlet />
    </div>
  );
}

export default function App() {
  return (
    <div style={{ fontFamily: "sans-serif", width: "100%" }}>
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
          <Route
            path="/staff/forgot-password"
            element={
              <RequireStaffPort>
                <StaffForgotPassword />
              </RequireStaffPort>
            }
          />
          <Route
            path="/staff/reset-password"
            element={
              <RequireStaffPort>
                <StaffResetPassword />
              </RequireStaffPort>
            }
          />
          <Route
            path="/hr/home"
            element={
              <RequireStaff minRole="HR_Officer">
                <HRHome />
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
          <Route
            path="/hr/departments"
            element={
              <RequireStaff minRole="HR_Officer">
                <DepartmentAdmin />
              </RequireStaff>
            }
          />
          {/* Manager/Director-only - the reimagined executive landing and
              the unified Approvals Center, see HRSidebar.jsx. */}
          <Route
            path="/hr/executive"
            element={
              <RequireStaff minRole="Manager">
                <ExecutiveDashboard />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/approvals"
            element={
              <RequireStaff minRole="Manager">
                <ApprovalsCenter />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/analytics"
            element={
              <RequireStaff minRole="Manager">
                <Analytics />
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
                <VacancyDetail />
              </RequireStaff>
            }
          />
          {/* Public - reached via a panelist's emailed/shared link, no login,
              and not gated by port since that link always points at the
              guest origin (see backend/src/config/frontendUrl.js) anyway. */}
          <Route path="/panel-score/:token" element={<PanelScoreAccess />} />
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
            <Route path="/jobs/:id" element={<JobDetails />} />
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/dashboard"
              element={
                <RequireCandidate>
                  <CandidateHome />
                </RequireCandidate>
              }
            />
            <Route
              path="/dashboard/jobs"
              element={
                <RequireCandidate>
                  <CandidateJobs />
                </RequireCandidate>
              }
            />
            <Route
              path="/dashboard/applications"
              element={
                <RequireCandidate>
                  <CandidateApplications />
                </RequireCandidate>
              }
            />
            <Route
              path="/dashboard/profile"
              element={
                <RequireCandidate>
                  <CandidateProfile />
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
          <Route
            path="/apply/:vacancyId"
            element={
              <RequireCandidate>
                <ApplyForm />
              </RequireCandidate>
            }
          />
        </Route>
      </Routes>
      </div>

      <Footer />
    </div>
  );
}
