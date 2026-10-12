import { SkillsManager } from "@/components/SkillsManager";
import { listSkillPlugins, listSkills } from "@/lib/api";

export default async function SkillsPage() {
  let plugins: Awaited<ReturnType<typeof listSkillPlugins>> = [];
  let skills: Awaited<ReturnType<typeof listSkills>> = [];
  let error: string | null = null;

  try {
    [plugins, skills] = await Promise.all([listSkillPlugins(), listSkills()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load skills";
  }

  return (
    <div className="page">
      {error ? (
        <p className="muted">{error}</p>
      ) : (
        <SkillsManager initialPlugins={plugins} initialSkills={skills} />
      )}
    </div>
  );
}
