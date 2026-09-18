import { useState } from "react";
import { ArrowRight, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
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
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((current) => current === "login" ? "register" : "login");
    setError("");
  };

  return (
    <main className="relative grid min-h-screen place-items-center bg-background px-4 py-16 text-foreground">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <Card className="w-full max-w-md bg-card">
        <CardHeader className="gap-3">
          <div className="flex items-center gap-3 text-primary"><span className="grid size-9 place-items-center bg-primary text-primary-foreground"><Scale className="size-4" aria-hidden="true" /></span><span>ReconSoft</span></div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Secure workspace</p>
            <CardTitle className="text-2xl">{mode === "login" ? "Sign in to ReconSoft" : "Create ReconSoft account"}</CardTitle>
            <CardDescription>{mode === "login" ? "Resume document review and prior reconciliations." : "Your documents and reports are isolated to this account."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            {error ? <Notice tone="danger" title="Could not sign in">{error}</Notice> : null}
            {mode === "register" ? (
              <div className="grid gap-2"><Label htmlFor="auth-name">Full name</Label><Input id="auth-name" name="name" value={values.name} onChange={update} autoComplete="name" required placeholder="Auditor name" /></div>
            ) : null}
            <div className="grid gap-2"><Label htmlFor="auth-email">Email address</Label><Input id="auth-email" name="email" type="email" value={values.email} onChange={update} autoComplete="email" required placeholder="you@firm.in" /></div>
            <div className="grid gap-2"><Label htmlFor="auth-password">Password</Label><Input id="auth-password" name="password" type="password" value={values.password} onChange={update} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required placeholder="Minimum 8 characters" /></div>
            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? <Spinner className="text-primary-foreground" label="Signing in" /> : null}
              {mode === "login" ? "Sign in" : "Create account"}<ArrowRight aria-hidden="true" />
            </Button>
            <div className="flex flex-wrap items-center justify-center gap-1 text-sm text-muted-foreground">
              <span>{mode === "login" ? "New to ReconSoft?" : "Already have an account?"}</span>
              <Button variant="link" className="h-auto px-1 py-0" type="button" onClick={switchMode}>{mode === "login" ? "Create account" : "Sign in"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
