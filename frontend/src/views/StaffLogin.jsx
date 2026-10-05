import React, { useState } from "react";
import { useNavigate, Navigate, useSearchParams, Link } from "react-router-dom";
import client from "../models/apiClient";
import { useAuth, useSessionEndedMessage } from "../models/AuthContext";
import { signInWithMicrosoft, isEntraConfigured } from "../models/entraAuth";
import { staffHome } from "../components/ProtectedRoute";
import PageHeader from "../components/PageHeader";
import TextField from "../components/TextField";
import Button from "../components/Button";
import Alert from "../components/Alert";
import MicrosoftSignInButton from "../components/MicrosoftSignInButton";

// Uganda Civil Aviation Authority brand palette
const ucaa = {
  navy: "#204D74", // Bay of Many
  blue: "#0C7ABF", // Denim
  tint: "#A6B1FF", // Melrose
  bg: "#EEF3F8",
  card: "#FFFFFF",
  line: "#DCE6EF",
};

// Staff sign in with their UCAA Microsoft account - there are no staff
// passwords. Being a UCAA employee isn't enough: the API only lets in
// someone a system administrator has given a staff account, with the role
// on that account (staffAuthController.entraLogin).
//
// /staff/login?password shows a password form instead, for the two cases
// the API still accepts one: a system administrator's break-glass sign-in
// while Microsoft sign-in is down (BREAK_GLASS_LOGIN), and the seeded demo
// accounts in local development (DEV_PASSWORD_LOGIN). It isn't linked from
// anywhere; with neither switched on, the API refuses it.
export default function StaffLogin() {
  const [params] = useSearchParams();
  const passwordMode = params.has("password");
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { loginStaff, staff } = useAuth();
  const sessionEnded = useSessionEndedMessage();
  const navigate = useNavigate();

  // Already signed in - see the same check in CandidateLogin.jsx.
  if (staff && (staff.role || staff.isSystemAdmin)) {
    return <Navigate to={staffHome(staff)} replace />;
  }

  const startSession = (data) => {
    loginStaff(data.token, data.role, data.name, data.email, data.isSystemAdmin);
    // `replace: true` - this login page must not stay in browser history
    // once login succeeds, or Back from inside the dashboard lands back on
    // the (now-stale) login form instead of leaving the app.
    navigate(staffHome(data), { replace: true });
  };

  const microsoftSignIn = async () => {
    setError("");
    setSubmitting(true);
    try {
      const idToken = await signInWithMicrosoft("staff");
      if (!idToken) return; // closed the Microsoft window
      const res = await client.post("/api/staff/auth/entra", { idToken });
      startSession(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const passwordSignIn = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.password) {
      setError("Email and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await client.post("/api/staff/auth/login", form);
      startSession(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "calc(100vh - var(--navbar-height) - var(--footer-height))",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(180deg, ${ucaa.blue} 0%, ${ucaa.navy} 100%)`,
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: ucaa.card,
          borderRadius: 12,
          borderTop: `4px solid ${ucaa.blue}`,
          padding: "32px 28px 24px",
          boxShadow: "0 20px 50px rgba(10,40,70,0.35)",
        }}
      >
        <PageHeader title="Staff login" />
        <Alert type="warning" message={sessionEnded} />
        {passwordMode ? (
          <>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
              Emergency administrator sign-in. It only works while it has been switched on at the server.
            </p>
            <form onSubmit={passwordSignIn} noValidate>
              <TextField
                label="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <TextField
                label="Password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Button type="submit" loading={submitting} loadingText="Signing in...">Log in</Button>
            </form>
            <p style={{ textAlign: "center", marginTop: 18, marginBottom: 0 }}>
              <Link to="/staff/login">Sign in with Microsoft instead</Link>
            </p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: "var(--color-text-muted)", marginTop: 0 }}>
              Sign in with your UCAA Microsoft account. You need a staff account on this system - ask
              the system administrator if you don't have one.
            </p>
            <MicrosoftSignInButton onClick={microsoftSignIn} loading={submitting} />
            {!isEntraConfigured("staff") && (
              <Alert type="warning" message="Microsoft sign-in has not been set up for this site yet." />
            )}
          </>
        )}
        <Alert type="error" message={error} />
      </div>
    </div>
  );
}
