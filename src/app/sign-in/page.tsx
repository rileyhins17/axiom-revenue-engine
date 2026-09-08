"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Activity, LockKeyhole, ShieldCheck } from "lucide-react";

import {
  AuthError,
  AuthFrame,
  authInputClassName,
  authLabelClassName,
} from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPath = searchParams.get("next");
  const nextPath =
    requestedPath && requestedPath.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath
      : "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        rememberMe: true,
      });

      if (result.error) {
        setError(result.error.message || "Unable to sign in.");
        return;
      }

      router.push(nextPath as Route);
      router.refresh();
    } catch {
      setError("Unable to reach the sign-in service. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthFrame
      badge="Revenue operations system"
      title={<>One workspace.<br /><span>Every pipeline signal.</span></>}
      description="Move from lead discovery to qualified conversations without losing the operational details between systems."
      signals={[
        { icon: Activity, label: "Live pipeline health" },
        { icon: ShieldCheck, label: "Controlled automation" },
        { icon: LockKeyhole, label: "Operator-only access" },
      ]}
      formTitle="Welcome back"
      formDescription="Sign in with your approved Axiom operations account."
      footer={<>Need access? Contact your workspace administrator. Public registration is disabled.</>}
    >
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email" className={authLabelClassName}>
                  Email
                </Label>
                <Input
                  id="email"
                  autoComplete="email"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                  placeholder="you@axiom.com"
                  className={authInputClassName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className={authLabelClassName}>
                  Password
                </Label>
                <Input
                  id="password"
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                  placeholder="••••••••"
                  className={authInputClassName}
                />
              </div>
              {error ? <AuthError message={error} /> : null}
              <Button className="v2-btn-primary h-12 w-full rounded-xl text-sm" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Signing in…" : "Enter workspace"}
              </Button>
            </form>
    </AuthFrame>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
