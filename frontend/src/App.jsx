import React from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";

import Home from "./views/Home";
import Register from "./views/Register";
import ConfirmEmail from "./views/ConfirmEmail";
import CandidateLogin from "./views/CandidateLogin";
import ForgotPassword from "./views/ForgotPassword";
import ResetPassword from "./views/ResetPassword";
import ProfileCompletePage from "./views/ProfileCompletePage";
import CandidateHome from "./views/CandidateHome";
import CandidateApplications from "./views/CandidateApplications";
import ApplyForm from "./views/ApplyForm";
import StaffLogin from "./views/StaffLogin";
import StaffForgotPassword from "./views/StaffForgotPassword";
import StaffResetPassword from "./views/StaffResetPassword";
import HRHome from "./views/HRHome";
import HRDashboard from "./views/HRDashboard";
import DepartmentAdmin from "./views/DepartmentAdmin";
import StaffAdmin from "./views/StaffAdmin";
import DelegationAdmin from "./views/DelegationAdmin";
import VacancyDetail from "./views/VacancyDetail";
import PanelScoreAccess from "./views/PanelScoreAccess";
import { RequireCandidate, RequireStaff, RequireStaffPort } from "./components/ProtectedRoute";

// Padding lives here, not on the app shell - Navbar/Footer render outside
// this entirely, full width with no inset. Only routes nested under this
// layout (plain views with no background/layout of their own) get a
// gutter; the self-contained full-bleed pages (login/register/apply,
// registered as siblings below) already manage their own edge-to-edge
// background and would get a second, unwanted inset if wrapped here too.
function PaddedLayout() {
  return (
    <div style={{ padding: 20 }}>
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
        <Route element={<PaddedLayout />}>
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
            path="/dashboard/applications"
            element={
              <RequireCandidate>
                <CandidateApplications />
              </RequireCandidate>
            }
          />
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
          <Route
            path="/hr/staff"
            element={
              <RequireStaff minRole="Principal_HR_Officer">
                <StaffAdmin />
              </RequireStaff>
            }
          />
          <Route
            path="/hr/delegations"
            element={
              <RequireStaff minRole="Senior_HR_Officer">
                <DelegationAdmin />
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
          {/* Public - reached via a panelist's emailed/shared link, no login */}
          <Route path="/panel-score/:token" element={<PanelScoreAccess />} />
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
        <Route
          path="/staff/login"
          element={
            <RequireStaffPort>
              <StaffLogin />
            </RequireStaffPort>
          }
        />
      </Routes>
      </div>

      <Footer />
    </div>
  );
}
