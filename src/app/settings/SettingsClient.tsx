"use client";

import { useEffect, useState } from "react";
import { Smartphone, UserRound } from "lucide-react";

import { Panel } from "@/components/owner/kit";
import { useProfilePicture } from "@/components/profile-picture";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AVATAR_CHANGED_EVENT } from "@/hooks/use-avatar-upload";

type UserProfile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string | null;
};

export function SettingsAccount({ userProfile }: { userProfile: UserProfile }) {
  const [image, setImage] = useState(userProfile.image);
  const picture = useProfilePicture();
  useEffect(() => {
    const onChanged = (event: Event) => setImage((event as CustomEvent<string>).detail || null);
    window.addEventListener(AVATAR_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, onChanged);
  }, []);
  const initial = (userProfile.email || userProfile.name || "?").charAt(0);

  return (
    <Panel title="Your account" icon={UserRound}>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-[#efe9dc] pb-4">
        <Avatar src={image} fallback={initial} size="xl" className="owner-avatar" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={picture.uploading} onClick={picture.choose}>
            {picture.uploading ? "Saving…" : "Change profile picture"}
          </Button>
          {image ? (
            <Button type="button" variant="ghost" size="sm" disabled={picture.uploading} onClick={() => void picture.remove()}>
              Remove
            </Button>
          ) : null}
        </div>
        {picture.input}
        {picture.error ? <p role="alert" className="w-full text-sm text-[#a1231b]">{picture.error}</p> : null}
      </div>
      <dl aria-label="Your account" className="divide-y divide-[#efe9dc]">
        <AccountRow label="Name" value={userProfile.name || "Name not set"} />
        <AccountRow label="Email" value={userProfile.email} />
        <AccountRow label="Access" value={userProfile.role ?? "user"} capitalize />
      </dl>
      <a href="/install" className="mt-4 flex items-center gap-2 border-t border-[#efe9dc] pt-4 text-sm font-semibold text-[#8a6420] hover:underline">
        <Smartphone className="size-4" aria-hidden="true" />
        Put the app on your iPhone home screen
      </a>
    </Panel>
  );
}

function AccountRow({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
      <dt className="text-[#5c584f]">{label}</dt>
      <dd className={`break-all font-medium text-[#0a0a0a] ${capitalize ? "capitalize" : ""}`}>{value}</dd>
    </div>
  );
}
