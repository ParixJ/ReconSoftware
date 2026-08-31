import { useState } from "react";
import { ArrowRight, CheckCircle2, FileSearch, LockKeyhole, Scale } from "lucide-react";
import { authApi, errorMessage } from "../api/client.js";
import { useAuthStore } from "../store/authStore.js";
import Notice from "../components/Notice.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

export default function AuthPage() {
  const [mode, setMode] = useState("login");
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const setUser = useAuthStore((state) => state.setUser);

  const update = (event) => setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { data } = mode === "login" ? await authApi.login(values) : await authApi.register(values);
      setUser(data.user);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally { setSubmitting(false); }
  };

  return (
    <main className="auth-page">
      <div className="auth-theme-control"><ThemeToggle /></div>
      <section className="auth-context" aria-labelledby="product-title">
        <div className="brand"><span className="brand-mark"><Scale size={20} /></span><span>Reconcile GST</span></div>
        <div className="auth-message">
          <p className="eyebrow">Audit-ready return review</p>
          <h1 id="product-title">Find return differences before they become filing risks.</h1>
          <p>Bring GSTR-1, GSTR-3B and GSTR-2B into one structured workspace. Source documents stay intact; every variance remains traceable.</p>
          <ul className="feature-list">
            <li><FileSearch size={18} /><span><strong>Automatic extraction</strong><small>PDF, XLSX, CSV and GST portal JSON</small></span></li>
            <li><CheckCircle2 size={18} /><span><strong>Rule-based checks</strong><small>Liability, ITC, identity and period anomalies</small></span></li>
            <li><LockKeyhole size={18} /><span><strong>Private workspaces</strong><small>Persistent sessions and user-owned documents</small></span></li>
          </ul>
        </div>
        <p className="auth-footnote">Built for auditors reviewing Indian GST returns</p>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-heading">
            <p className="eyebrow">Secure workspace</p>
            <h2>{mode === "login" ? "Sign in to continue" : "Create auditor account"}</h2>
            <p>{mode === "login" ? "Resume document review and prior reconciliations." : "Your documents and reports are isolated to this account."}</p>
          </div>
          {error ? <Notice tone="danger" title="Could not sign in">{error}</Notice> : null}
          {mode === "register" ? (
            <label className="field"><span>Full name</span><input name="name" value={values.name} onChange={update} autoComplete="name" required placeholder="Auditor name" /></label>
          ) : null}
          <label className="field"><span>Email address</span><input name="email" type="email" value={values.email} onChange={update} autoComplete="email" required placeholder="you@firm.in" /></label>
          <label className="field"><span>Password</span><input name="password" type="password" value={values.password} onChange={update} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required placeholder="Minimum 8 characters" /></label>
          <button className="button button-primary button-full" disabled={submitting}>
            {submitting ? <span className="spinner spinner-light" /> : null}
            {mode === "login" ? "Sign in" : "Create account"}<ArrowRight size={17} />
          </button>
          <div className="auth-switch">
            <span>{mode === "login" ? "New to Reconcile GST?" : "Already have an account?"}</span>
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "Create account" : "Sign in"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

