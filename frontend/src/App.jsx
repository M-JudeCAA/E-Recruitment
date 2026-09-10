import React from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import StaffDashboardLayout from "./components/StaffDashboardLayout";
import CandidateDashboardLayout from "./components/CandidateDashboardLayout";

import Home from "./views/Home";
import Register from "./views/Register";
import ConfirmEmail from "./views/ConfirmEmail";
import CandidateLogin from "./views/CandidateLogin";
import ForgotPassword from "./views/ForgotPassword";
import ResetPassword from "./views/ResetPassword";
import ApplyForm from "./views/ApplyForm";
import StaffLogin from "./views/StaffLogin";
import StaffForgotPassword from "./views/StaffForgotPassword";
import StaffResetPassword from "./views/StaffResetPassword";
import PanelScoreAccess from "./views/PanelScoreAccess";
import HRHome from "./views/hr/HRHome";
import HRVacancies from "./views/hr/HRVacancies";
import DepartmentAdmin from "./views/hr/DepartmentAdmin";
import StaffAdmin from "./views/hr/StaffAdmin";
import DelegationAdmin from "./views/hr/DelegationAdmin";
import VacancyDetail from "./views/hr/VacancyDetail";
import CandidateHome from "./views/candidate/CandidateHome";
import CandidateApplications from "./views/candidate/CandidateApplications";
import CandidateProfile from "./views/candidate/CandidateProfile";
import CandidateRecords from "./views/candidate/CandidateRecords";
import { RequireCandidate, RequireStaff } from "./components/ProtectedRoute";

// The "site" chrome (top navbar + footer) - only for the public
// jobs-board pages and the various auth flows. The two dashboards
// (/hr, /dashboard) are their own full-height sidebar shells with no
// navbar/footer, rendered as separate top-level route trees below.
//
// A flex column pinned to at least the viewport height, with the Outlet
// wrapper as the flexible middle - this is what keeps Footer sitting at
// the bottom of the screen on short pages instead of floating up right
// after a half-empty page, while still letting it flow below the
// content (not overlap it) on pages taller than the viewport.
function SiteShell() {
  return (
    <div style={{ fontFamily: "sans-serif", width: "100%", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}

// Padding lives here, not on SiteShell itself - the self-contained
// full-bleed pages (login/register/apply, siblings of this layout
// within SiteShell) already manage their own edge-to-edge background and
// would get a second, unwanted inset if wrapped in this too. No max-width
// here - the page fills the full browser width, same as before the
// dashboard redesign.
function PaddedLayout() {
  return (
    <div style={{ flex: 1, padding: "28px 24px", width: "100%", boxSizing: "border-box" }}>
      <Outlet />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<SiteShell />}>
        <Route element={<PaddedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/confirm-email" element={<ConfirmEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/staff/forgot-password" element={<StaffForgotPassword />} />
          <Route path="/staff/reset-password" element={<StaffResetPassword />} />
          {/* Public - reached via a panelist's emailed/shared link, no login */}
          <Route path="/panel-score/:token" element={<PanelScoreAccess />} />
        </Route>

        {/* Full-bleed, self-contained pages - NOT wrapped in PaddedLayout.
            Each already renders its own edge-to-edge width:100% background
            (a full-viewport gradient card, or the wizard's own themed
            wrapper), so adding padding here would inset that background
            from the window edge - the exact bug this layout split avoids. */}
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<CandidateLogin />} />
        <Route path="/staff/login" element={<StaffLogin />} />
        <Route
          path="/apply/:vacancyId"
          element={
            <RequireCandidate>
              <ApplyForm />
            </RequireCandidate>
          }
        />
      </Route>

      {/* HR dashboard - its own sidebar shell, nested tabs render into it
          via Outlet. The layout route itself only requires HR_Officer (the
          floor for the whole area); individual tabs re-guard at their own,
          stricter minRole exactly as they did as standalone routes. */}
      <Route
        path="/hr"
        element={
          <RequireStaff minRole="HR_Officer">
            <StaffDashboardLayout />
          </RequireStaff>
        }
      >
        <Route index element={<HRHome />} />
        <Route path="vacancies" element={<HRVacancies />} />
        <Route path="vacancy/:id" element={<VacancyDetail />} />
        <Route path="departments" element={<DepartmentAdmin />} />
        <Route
          path="staff"
          element={
            <RequireStaff minRole="Principal_HR_Officer">
              <StaffAdmin />
            </RequireStaff>
          }
        />
        <Route
          path="delegations"
          element={
            <RequireStaff minRole="Senior_HR_Officer">
              <DelegationAdmin />
            </RequireStaff>
          }
        />
      </Route>

      {/* Candidate dashboard - same pattern, candidate-facing tabs. */}
      <Route
        path="/dashboard"
        element={
          <RequireCandidate>
            <CandidateDashboardLayout />
          </RequireCandidate>
        }
      >
        <Route index element={<CandidateHome />} />
        <Route path="applications" element={<CandidateApplications />} />
        <Route path="profile" element={<CandidateProfile />} />
        <Route path="records" element={<CandidateRecords />} />
      </Route>
    </Routes>
  );
}
