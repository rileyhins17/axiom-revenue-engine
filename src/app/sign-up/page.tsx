import Link from "next/link";
import { LockKeyhole, ShieldCheck, UserCheck } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";

export default function SignUpPage() {
  return (
    <AuthFrame
      badge="Private workspace"
      title={<>Access is private.<br /><span>Your business stays yours.</span></>}
      description="Axiom Revenue Engine is an internal workspace for approved operators."
      signals={[
        { icon: LockKeyhole, label: "Public registration disabled" },
        { icon: ShieldCheck, label: "No self-service access" },
        { icon: UserCheck, label: "Administrator-managed accounts" },
      ]}
      formTitle="Registration is closed"
      formDescription="Knowing an approved email address does not grant access."
      footer={<Link className="font-medium text-emerald-300 hover:text-emerald-200" href="/sign-in">Back to sign in</Link>}
    >
      <p className="text-sm leading-relaxed text-slate-300">
        If you need an account or cannot access an existing one, contact your
        workspace administrator directly. Do not share your password or recovery codes.
      </p>
    </AuthFrame>
  );
}
