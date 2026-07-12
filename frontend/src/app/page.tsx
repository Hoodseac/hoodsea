import { redirect } from "next/navigation";

// Root serves the marketing landing page; the app board lives at /explore.
export default function Home() {
  redirect("/landing");
}
