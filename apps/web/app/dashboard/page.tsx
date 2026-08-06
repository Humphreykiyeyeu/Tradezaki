import { redirect } from "next/navigation";

/** The terminal moved to /trade; keep old links and bookmarks working. */
export default function DashboardRedirect() {
  redirect("/trade");
}
