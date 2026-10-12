import { redirect } from "next/navigation";

/** Create opens a fresh blank Word workspace; Capco Wayne offers template / upload / AI draft. */
export default function CreatePage() {
  redirect("/workspace?mode=create");
}
