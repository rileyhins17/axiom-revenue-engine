import { redirect } from "next/navigation";

// Retired Codex screen: the app is now Today, Call list and Settings.
export default function RetiredPage() {
  redirect("/prospects");
}
