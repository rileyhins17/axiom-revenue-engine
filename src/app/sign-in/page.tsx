"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, Lock } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { OWNER_CHOICES as OWNER_LOGINS, type OwnerChoice as OwnerKey } from "@/lib/owner-login-public";

type Step = { kind: "pick" } | { kind: "code"; owner: OwnerKey } | { kind: "done" };

function CodeBoxes({ disabled, onComplete }: { disabled: boolean; onComplete: (code: string) => void }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { refs.current[0]?.focus(); }, []);
  function set(index: number, value: string) {
    const clean = value.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      const filled = [...next, ...Array(6 - next.length).fill("")];
      setDigits(filled);
      refs.current[Math.min(5, next.length)]?.focus();
      if (next.length === 6) onComplete(next.join(""));
      return;
    }
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 5) refs.current[index + 1]?.focus();
    if (next.every(Boolean)) onComplete(next.join(""));
  }
  return <div className="flex justify-center gap-2 sm:gap-3" role="group" aria-label="Six-digit code">
    {digits.map((digit, index) => <input key={index} ref={(el) => { refs.current[index] = el; }} value={digit} disabled={disabled}
      inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={6} aria-label={`Digit ${index + 1}`}
      onChange={(event) => set(index, event.target.value)}
      onKeyDown={(event) => { if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus(); }}
      className="size-12 rounded-xl border border-[#2a2a2a] bg-[#111] text-center font-[family-name:var(--font-fraunces)] text-2xl text-[#f7ecd4] outline-none transition focus:border-[#b8893b] focus:shadow-[0_0_0_4px_rgba(184,137,59,0.18)] sm:size-14" />)}
  </div>;
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("next");
  const nextPath = requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  async function sendCode(owner: OwnerKey) {
    setBusy(true); setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: OWNER_LOGINS[owner].account, type: "sign-in" }).catch(() => null);
    setBusy(false);
    if (!result || result.error) { setError(result?.error?.status === 429 ? "Too many tries. Wait a few minutes." : "Couldn't send the code. Try again."); return; }
    setStep({ kind: "code", owner });
  }

  async function verify(owner: OwnerKey, code: string) {
    setBusy(true); setError(null);
    const result = await authClient.signIn.emailOtp({ email: OWNER_LOGINS[owner].account, otp: code }).catch(() => null);
    if (!result || result.error) {
      setBusy(false); setAttempt((n) => n + 1);
      setError(result?.error?.status === 429 ? "Too many tries. Wait a few minutes." : "That code didn't work. Check the latest email.");
      return;
    }
    setStep({ kind: "done" });
    router.replace(nextPath as Route);
    router.refresh();
  }

  return <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#070707] px-4 text-[#f2f0ea]">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_400px_at_50%_-10%,rgba(184,137,59,0.22),transparent_70%)]" />
    <div aria-hidden="true" className="pointer-events-none absolute -inset-1/2 animate-[owner-spin_40s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0_75%,rgba(227,192,122,0.06)_85%,transparent_95%)]" />
    <div className="owner-signin-enter relative w-full max-w-md text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/axiom-logo.webp" alt="Axiom" width={200} height={54} className="mx-auto h-auto w-[200px] drop-shadow-[0_10px_30px_rgba(0,0,0,0.7)]" />
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#a09c92]"><Lock className="size-3" aria-hidden="true" />Private</p>

      {step.kind === "pick" ? <div className="mt-10">
        <h1 className="font-[family-name:var(--font-fraunces)] text-3xl">Who&apos;s signing in?</h1>
        <div className="mt-8 grid grid-cols-2 gap-4">
          {(Object.keys(OWNER_LOGINS) as OwnerKey[]).map((key) => <button key={key} type="button" disabled={busy} onClick={() => void sendCode(key)}
            className="group rounded-2xl border border-[#222] bg-[#0f0f0f] px-4 py-8 transition duration-300 hover:-translate-y-1 hover:border-[#b8893b]/60 hover:shadow-[0_20px_50px_-20px_rgba(184,137,59,0.5)] active:scale-[0.98] disabled:opacity-60">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-[#e3c07a] to-[#8a6420] font-[family-name:var(--font-fraunces)] text-2xl text-[#0a0a0a] shadow-[0_10px_30px_-10px_rgba(227,192,122,0.6)] transition group-hover:scale-105">{OWNER_LOGINS[key].name[0]}</span>
            <span className="mt-4 block text-lg font-semibold">{OWNER_LOGINS[key].name}</span>
          </button>)}
        </div>
        <p className="mt-6 text-xs text-[#8a867c]">{busy ? "Sending your code…" : "We'll email you a 6-digit code. No passwords."}</p>
      </div> : null}

      {step.kind === "code" ? <div className="mt-10">
        <h1 className="font-[family-name:var(--font-fraunces)] text-3xl">Check your email, {OWNER_LOGINS[step.owner].name}</h1>
        <p className="mt-2 text-sm text-[#bdb8ad]">We sent a code to {OWNER_LOGINS[step.owner].maskedInbox}</p>
        <div className="mt-8"><CodeBoxes key={attempt} disabled={busy} onComplete={(code) => void verify(step.owner, code)} /></div>
        <p className="mt-4 h-5 text-sm text-[#bdb8ad]" aria-live="polite">{busy ? "Checking…" : ""}</p>
        <div className="mt-2 flex justify-center gap-5 text-sm">
          <button type="button" onClick={() => { setStep({ kind: "pick" }); setError(null); }} className="inline-flex items-center gap-1 text-[#bdb8ad] hover:text-white"><ArrowLeft className="size-4" aria-hidden="true" />Back</button>
          <button type="button" disabled={busy} onClick={() => void sendCode(step.owner)} className="text-[#e3c07a] hover:underline">Send a new code</button>
        </div>
      </div> : null}

      {step.kind === "done" ? <p className="mt-10 font-[family-name:var(--font-fraunces)] text-2xl owner-pop">Welcome back.</p> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-[#f0a38c]">{error}</p> : null}
    </div>
  </main>;
}

export default function SignInPage() {
  return <Suspense fallback={<main className="min-h-svh bg-[#070707]" />}><SignIn /></Suspense>;
}
