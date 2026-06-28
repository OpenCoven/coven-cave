import { redirect } from "next/navigation";

export default function RetroDashboardRedirectPage() {
  redirect("/dashboard?view=evals");
}
