"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { BadgeCheck, LockKeyhole, UserCheck } from "lucide-react";

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

export default function SignUpPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.signUp.email({
        name,
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || "Unable to create account.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to reach the account service. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthFrame
      badge="Operator provisioning"
      title={<>Build pipeline<br /><span>with confidence.</span></>}
      description="Axiom keeps lead quality, outreach safety, conversations, and revenue movement in one accountable workspace."
      signals={[
        { icon: BadgeCheck, label: "Approved emails only" },
        { icon: LockKeyhole, label: "12 character minimum" },
        { icon: UserCheck, label: "Role-based controls" },
      ]}
      formTitle="Create your account"
      formDescription="Registration is limited to approved Axiom operator addresses."
      footer={<>Already have access? <Link className="font-medium text-emerald-300 hover:text-emerald-200" href="/sign-in">Sign in</Link></>}
    >
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="name" className={authLabelClassName}>Full name</Label>
                <Input
                  id="name"
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                  className={authInputClassName}
                  placeholder="Ada Lovelace"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className={authLabelClassName}>Work email</Label>
                <Input
                  id="email"
                  autoComplete="email"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                  className={authInputClassName}
                  placeholder="you@axiom.com"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="password" className={authLabelClassName}>Password</Label>
                  <Input
                    id="password"
                    autoComplete="new-password"
                    minLength={12}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                    className={authInputClassName}
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className={authLabelClassName}>Confirm</Label>
                  <Input
                    id="confirmPassword"
                    autoComplete="new-password"
                    minLength={12}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    type="password"
                    value={confirmPassword}
                    className={authInputClassName}
                    placeholder="••••••••"
                  />
                </div>
              </div>
              {error ? <AuthError message={error} /> : null}
              <Button className="v2-btn-primary h-12 w-full rounded-xl text-sm" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Creating account…" : "Create operator account"}
              </Button>
            </form>
    </AuthFrame>
  );
}
