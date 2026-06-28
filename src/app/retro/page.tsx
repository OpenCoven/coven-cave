import { redirect } from "next/navigation";

export default function RetroRedirectPage() {
  redirect("/dashboard?view=evals");
}
