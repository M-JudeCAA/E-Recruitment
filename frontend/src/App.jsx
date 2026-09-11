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
import CandidateDashboard from "./views/CandidateDashboard";
import ProfileCompletePage from "./views/ProfileCompletePage";
import ApplyForm from "./views/ApplyForm";
import StaffLogin from "./views/StaffLogin";
import StaffForgotPassword from "./views/StaffForgotPassword";
import StaffResetPassword from "./views/StaffResetPassword";
import HRDashboard from "./views/HRDashboard";
import DepartmentAdmin from "./views/DepartmentAdmin";
import StaffAdmin from "./views/StaffAdmin";
import DelegationAdmin from "./views/DelegationAdmin";
import VacancyDetail from "./views/VacancyDetail";
import PanelScoreAccess from "./views/PanelScoreAccess";
import { RequireCandidate, RequireStaff } from "./components/ProtectedRoute";

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

      <Routes>
        <Route element={<PaddedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/confirm-email" element={<ConfirmEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/dashboard"
            element={
              <RequireCandidate>
                <CandidateDashboard />
              </RequireCandidate>
            }
          />
          <Route
            path="/staff/forgot-password"
            element={<StaffForgotPassword />}
          />
          <Route path="/staff/reset-password" element={<StaffResetPassword />} />
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
        <Route path="/staff/login" element={<StaffLogin />} />
      </Routes>

      <Footer />
    </div>
  );
}
