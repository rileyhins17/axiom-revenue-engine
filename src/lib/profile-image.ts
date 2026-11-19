/** Rules for the saved profile picture: a small JPEG, PNG or WebP stored as text on the user row. */
export const MAX_PROFILE_IMAGE_BYTES = 200_000;

const DATA_URI = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function validateProfileImage(image: string): string | null {
  const match = DATA_URI.exec(image);
  if (!match) return "Picture must be a JPEG, PNG or WebP image";
  const sizeBytes = Math.ceil((match[1].length * 3) / 4);
  if (sizeBytes > MAX_PROFILE_IMAGE_BYTES) {
    return `Picture must be under ${MAX_PROFILE_IMAGE_BYTES / 1000}KB`;
  }
  return null;
}
