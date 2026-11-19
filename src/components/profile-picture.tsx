"use client";

import { useRef } from "react";

import { useAvatarUpload } from "@/hooks/use-avatar-upload";

/**
 * One hidden file picker for the profile picture. `choose()` opens it from any button
 * (header menu, phone More sheet, Settings); the new picture is saved and announced to the page.
 */
export function useProfilePicture() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploading, error, upload, remove } = useAvatarUpload();

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="sr-only"
      tabIndex={-1}
      aria-label="Choose a profile picture"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) await upload(file);
      }}
    />
  );

  return { input, choose: () => inputRef.current?.click(), remove, uploading, error };
}
