import { NavHeader } from "@/components/nav-header";
import { SettingsForm } from "@/components/settings-form";
import { getSettings } from "@/app/settings-actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <main className="min-h-screen bg-background">
      <NavHeader />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          System Settings
        </h2>

        <SettingsForm initialValues={settings} />
      </div>
    </main>
  );
}
