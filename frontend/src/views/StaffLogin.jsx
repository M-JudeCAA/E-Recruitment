import React, { useState } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import client from "../models/apiClient";
import { useAuth } from "../models/AuthContext";
import PageHeader from "../components/PageHeader";
import TextField from "../components/TextField";
import Button from "../components/Button";
import Alert from "../components/Alert";

// Uganda Civil Aviation Authority brand palette
const ucaa = {
  navy: "#204D74", // Bay of Many
  blue: "#0C7ABF", // Denim
  tint: "#A6B1FF", // Melrose
  bg: "#EEF3F8",
  card: "#FFFFFF",
  line: "#DCE6EF",
};

// Matches the same 5-tier ROLE_RANK used everywhere else (auth.js,
// Navbar.jsx, HRSidebar.jsx) - Manager/Director land on the reimagined
// Executive Overview, everyone else on the operational Home.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

function validate(values) {
  const errors = {};

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (values.password.length < 6) {
    errors.password = "Password must be at least 6 characters.";
  }

  return errors;
}

export default function StaffLogin() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { loginStaff, staff } = useAuth();
  const navigate = useNavigate();

  // Already signed in - the `replace: true` below on a successful submit
  // only keeps THIS page from staying reachable by Back after login;
  // it does nothing to stop this route being reached some other way
  // (a stale bookmark/tab, a second tab, or - per a real report - Back
  // still landing here in some sequence) while the session is still
  // valid. Navbar renders unconditionally on every route (see App.jsx),
  // so without this an already-authenticated staff member would see
  // their own logged-in navbar above a fully live login form underneath.
  // Redirect away before ever rendering that form.
  if (staff) {
    const alreadyExecutive = (ROLE_RANK[staff.role] || 0) >= ROLE_RANK.Manager;
    return <Navigate to={alreadyExecutive ? "/hr/executive" : "/hr/home"} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      // Combined into one message since Alert only surfaces a single string.
      setError(Object.values(errors).join(" "));
      return;
    }

    setSubmitting(true);
    try {
      const res = await client.post("/api/staff/auth/login", form);
      loginStaff(res.data.token, res.data.role, res.data.name, res.data.email);
      const isExecutive = (ROLE_RANK[res.data.role] || 0) >= ROLE_RANK.Manager;
      // `replace: true` - this login page must not stay in browser history
      // once login succeeds, or Back from inside the dashboard lands back
      // on the (now-stale) login form instead of leaving the app. Every
      // navigation made *after* this one is normal history, so Back still
      // steps through those as expected.
      navigate(isExecutive ? "/hr/executive" : "/hr/home", { replace: true });
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
        <form onSubmit={handleSubmit} noValidate>
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
          <Button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Log in"}
          </Button>
        </form>
        <Alert type="error" message={error} />
        <p style={{ textAlign: "center", marginTop: 18, marginBottom: 0 }}>
          <Link to="/staff/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
