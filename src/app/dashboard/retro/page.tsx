import { redirect } from "next/navigation";

export default function RetroDashboardRedirectPage() {
  redirect("/?mode=evals");
}
