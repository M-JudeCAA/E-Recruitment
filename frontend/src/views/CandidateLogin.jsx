import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import client from "../models/apiClient";
import { useAuth } from "../models/AuthContext";
import PageHeader from "../components/PageHeader";
import TextField from "../components/TextField";
import Button from "../components/Button";
import Alert from "../components/Alert";

// CHANGED - was a separate, hardcoded palette disconnected from
// theme.css. Now reads the same shared CSS variables as the rest of the
// app, closing a real visual-drift gap found while adopting the new
// design direction.
const ucaa = {
  navy: "var(--color-primary-dark)",
  blue: "var(--color-primary)",
  tint: "var(--color-primary-light)",
  card: "var(--color-bg)",
};

const RETURN_TO_RE = /^\/apply\/\d+$/;

function validate(values) {
  const errors = {};

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  // Deliberately no length/complexity check here - login only checks a
  // password against its stored hash, and a client-side "too short"
  // rejection would be actively wrong for an account created before the
  // password policy existed. The server's bcrypt compare is the only
  // source of truth for whether a login password is correct.
  if (!values.password) {
    errors.password = "Password is required.";
  }

  return errors;
}

export default function CandidateLogin() {
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || sessionStorage.getItem("pendingReturnTo");
  const validReturnTo = returnTo && RETURN_TO_RE.test(returnTo) ? returnTo : null;

  useEffect(() => {
    if (validReturnTo) sessionStorage.setItem("pendingReturnTo", validReturnTo);
  }, [validReturnTo]);

  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { loginCandidate } = useAuth();
  const navigate = useNavigate();

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
      const res = await client.post("/api/candidates/auth/login", form);
      loginCandidate(res.data.token, res.data.candidateType, res.data.fullName, res.data.photoUrl);
      sessionStorage.removeItem("pendingReturnTo");

      // Precedence: a pending Apply-page destination always wins, even on
      // a first-ever login - the Advert User path takes over from the
      // New User "go straight to the full profile page" rule in that
      // case (see ApplyForm.jsx, which shows the completion modal itself).
      if (validReturnTo) navigate(validReturnTo);
      else if (res.data.firstLogin) navigate("/profile/complete");
      else navigate("/dashboard");
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
        <PageHeader title="Candidate login" />
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
        <p style={{ textAlign: "center", marginTop: 18, marginBottom: 4 }}>
          <Link to={validReturnTo ? `/register?returnTo=${encodeURIComponent(validReturnTo)}` : "/register"}>
            Create an account
          </Link>
        </p>
        <p style={{ textAlign: "center", marginTop: 0, marginBottom: 0 }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
