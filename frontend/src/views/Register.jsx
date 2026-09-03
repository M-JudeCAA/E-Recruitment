// import React, { useState } from 'react';
// import client from '../models/apiClient';
// import PageHeader from '../components/PageHeader';
// import TextField from '../components/TextField';
// import Button from '../components/Button';
// import Alert from '../components/Alert';

// export default function Register() {
//   const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '', nationalId: '' });
//   const [message, setMessage] = useState('');
//   const [error, setError] = useState('');

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     setMessage(''); setError('');
//     try {
//       const res = await client.post('/api/candidates/auth/register', form);
//       setMessage(`${res.data.message} (Account type: ${res.data.candidateType})`);
//     } catch (err) {
//       setError(err.response?.data?.error || 'Something went wrong');
//     }
//   };

//   return (
//     <div style={{ maxWidth: 420 }}>
//       <PageHeader
//         title="Create account"
//         subtitle="Registering with a @caa.co.ug email creates an internal-staff account automatically."
//       />
//       <form onSubmit={handleSubmit}>
//         <TextField label="Full name" value={form.fullName}
//           onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
//         <TextField label="Email" type="email" value={form.email}
//           onChange={(e) => setForm({ ...form, email: e.target.value })} required />
//         <TextField label="Phone" value={form.phone}
//           onChange={(e) => setForm({ ...form, phone: e.target.value })} />
//         <TextField label="National ID / Passport" value={form.nationalId}
//           onChange={(e) => setForm({ ...form, nationalId: e.target.value })} />
//         <TextField label="Password" type="password" value={form.password}
//           onChange={(e) => setForm({ ...form, password: e.target.value })} required />
//         <Button type="submit">Register</Button>
//       </form>
//       <Alert type="success" message={message} />
//       <Alert type="error" message={error} />
//     </div>
//   );
// }

import React, { useState } from "react";
import client from "../models/apiClient";
import PageHeader from "../components/PageHeader";
import TextField from "../components/TextField";
import Button from "../components/Button";
import Alert from "../components/Alert";

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
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (values.phone.trim() && !/^\+?[0-9\s-]{7,15}$/.test(values.phone.trim())) {
    errors.phone = "Enter a valid phone number.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (values.password.length < 6) {
    errors.password = "Password must be at least 6 characters.";
  }

  return errors;
}

export default function Register() {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    nationalId: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      // Combined into one message since Alert only surfaces a single string.
      setError(Object.values(errors).join(" "));
      return;
    }

    setSubmitting(true);
    try {
      const res = await client.post("/api/candidates/auth/register", form);
      setMessage(
        `${res.data.message} (Account type: ${res.data.candidateType})`,
      );
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
            required
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <TextField
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <TextField
            label="National ID / Passport"
            value={form.nationalId}
            onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
          />
          <TextField
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating account..." : "Register"}
          </Button>
        </form>
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
      </div>
    </div>
  );
}
