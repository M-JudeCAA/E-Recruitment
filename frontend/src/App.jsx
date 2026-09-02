import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';

import Home from './views/Home';
import Register from './views/Register';
import ConfirmEmail from './views/ConfirmEmail';
import CandidateLogin from './views/CandidateLogin';
import ForgotPassword from './views/ForgotPassword';
import ResetPassword from './views/ResetPassword';
import CandidateDashboard from './views/CandidateDashboard';
import ApplyForm from './views/ApplyForm';
import StaffLogin from './views/StaffLogin';
import StaffForgotPassword from './views/StaffForgotPassword';
import StaffResetPassword from './views/StaffResetPassword';
import HRDashboard from './views/HRDashboard';
import VacancyDetail from './views/VacancyDetail';
import PanelScoreAccess from './views/PanelScoreAccess';
import { RequireCandidate, RequireStaff } from './components/ProtectedRoute';

export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto', padding: 20 }}>
      <Navbar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/confirm-email" element={<ConfirmEmail />} />
        <Route path="/login" element={<CandidateLogin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dashboard" element={<RequireCandidate><CandidateDashboard /></RequireCandidate>} />
        <Route path="/apply/:vacancyId" element={<RequireCandidate><ApplyForm /></RequireCandidate>} />

        <Route path="/staff/login" element={<StaffLogin />} />
        <Route path="/staff/forgot-password" element={<StaffForgotPassword />} />
        <Route path="/staff/reset-password" element={<StaffResetPassword />} />
        <Route path="/hr" element={<RequireStaff minRole="HR_Officer"><HRDashboard /></RequireStaff>} />
        <Route path="/hr/vacancy/:id" element={<RequireStaff minRole="HR_Officer"><VacancyDetail /></RequireStaff>} />
        {/* Public - reached via a panelist's emailed/shared link, no login */}
        <Route path="/panel-score/:token" element={<PanelScoreAccess />} />
      </Routes>
    </div>
  );
}
