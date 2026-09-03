import React from "react";
import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";

import Home from "./views/Home";
import Register from "./views/Register";
import ConfirmEmail from "./views/ConfirmEmail";
import CandidateLogin from "./views/CandidateLogin";
import ForgotPassword from "./views/ForgotPassword";
import ResetPassword from "./views/ResetPassword";
import CandidateDashboard from "./views/CandidateDashboard";
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

export default function App() {
  return (
    <div
      style={{
        fontFamily: "sans-serif",
        margin: "0 auto",
        padding: 20,
        width: "100%",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
      }}
    >
      <Navbar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/confirm-email" element={<ConfirmEmail />} />
        <Route path="/login" element={<CandidateLogin />} />
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
          path="/apply/:vacancyId"
          element={
            <RequireCandidate>
              <ApplyForm />
            </RequireCandidate>
          }
        />

        <Route path="/staff/login" element={<StaffLogin />} />
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
      </Routes>
    </div>
  );
}
