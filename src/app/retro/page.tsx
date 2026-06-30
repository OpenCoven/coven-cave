import { redirect } from "next/navigation";

export default function RetroRedirectPage() {
  redirect("/?mode=evals");
}
