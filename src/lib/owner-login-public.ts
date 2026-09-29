/** Client-safe owner list for the public sign-in page: no real inbox addresses. */
export const OWNER_CHOICES = {
  riley: { name: "Riley", account: "riley@getaxiom.ca", maskedInbox: "r••••••••••••••@gmail.com" },
  aidan: { name: "Aidan", account: "aidan@getaxiom.ca", maskedInbox: "a•••••••••••••••••@gmail.com" },
} as const;
export type OwnerChoice = keyof typeof OWNER_CHOICES;
