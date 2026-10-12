import { HomeChat } from "@/components/HomeChat";
import { listTemplates } from "@/lib/api";

export default async function HomePage() {
  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  try {
    templates = await listTemplates();
  } catch {
    templates = [];
  }
  return <HomeChat templates={templates} />;
}
