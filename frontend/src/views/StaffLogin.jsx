import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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
  const { loginStaff } = useAuth();
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
      const res = await client.post("/api/staff/auth/login", form);
      loginStaff(res.data.token, res.data.role, res.data.name);
      navigate("/hr");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
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
