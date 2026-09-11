import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import client from "../models/apiClient";
import PageHeader from "../components/PageHeader";
import TextField from "../components/TextField";
import Button from "../components/Button";
import Alert from "../components/Alert";
import { validateEmail, validatePassword, PASSWORD_HINT } from "../utils/validators";

// Uganda Civil Aviation Authority brand palette
const ucaa = {
  navy: "#204D74", // Bay of Many
  blue: "#0C7ABF", // Denim
  tint: "#A6B1FF", // Melrose
  card: "#FFFFFF",
};

function validate(values) {
  const errors = {};

  if (!values.fullName.trim()) {
    errors.fullName = "Full name is required.";
  }

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!validateEmail(values.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (values.phone.trim() && !/^\+?[0-9\s-]{7,15}$/.test(values.phone.trim())) {
    errors.phone = "Enter a valid phone number.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (!validatePassword(values.password)) {
    errors.password = PASSWORD_HINT;
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

const RETURN_TO_RE = /^\/apply\/\d+$/;

export default function Register() {
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || sessionStorage.getItem("pendingReturnTo");
  const validReturnTo = returnTo && RETURN_TO_RE.test(returnTo) ? returnTo : null;
  useEffect(() => {
    if (validReturnTo) sessionStorage.setItem("pendingReturnTo", validReturnTo);
  }, [validReturnTo]);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    nationalId: "",
  });
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const errors = validate(form);
  const showError = (field) => (touched[field] || submitted) ? errors[field] : undefined;
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");
    setSubmitted(true);

    if (Object.keys(errors).length > 0) {
      setError("Please fix the highlighted fields.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await client.post("/api/candidates/auth/register", { ...form, returnTo: validReturnTo });
      setMessage(
        `${res.data.message} (Account type: ${res.data.candidateType})`,
      );
      setForm({
        fullName: "",
        email: "",
        password: "",
        confirmPassword: "",
        phone: "",
        nationalId: "",
      });
      setTouched({});
      setSubmitted(false);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
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
          maxWidth: 420,
          background: ucaa.card,
          borderRadius: 12,
          borderTop: `4px solid ${ucaa.blue}`,
          padding: "32px 28px 24px",
          boxShadow: "0 20px 50px rgba(10,40,70,0.35)",
        }}
      >
        <PageHeader
          title="Create account"
          subtitle="Registering with a @caa.co.ug email creates an internal-staff account automatically."
        />
        <form onSubmit={handleSubmit} noValidate>
          <TextField
            label="Full name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            onBlur={blur("fullName")}
            error={showError("fullName")}
            required
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            onBlur={blur("email")}
            error={showError("email")}
            required
          />
          <TextField
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            onBlur={blur("phone")}
            error={showError("phone")}
          />
          <TextField
            label="National ID / Passport"
            hint="You can also add or refine this on your profile later"
            value={form.nationalId}
            onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
          />
          <TextField
            label="Password"
            type="password"
            hint={PASSWORD_HINT}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            onBlur={blur("password")}
            error={showError("password")}
            required
          />
          <TextField
            label="Confirm password"
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            onBlur={blur("confirmPassword")}
            error={showError("confirmPassword")}
            required
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating account..." : "Register"}
          </Button>
        </form>
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
        <p style={{ textAlign: "center", marginTop: 18, marginBottom: 0 }}>
          <Link to={validReturnTo ? `/login?returnTo=${encodeURIComponent(validReturnTo)}` : "/login"}>
            Already have an account? Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
