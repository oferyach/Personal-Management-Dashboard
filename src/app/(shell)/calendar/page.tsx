import { PhasePlaceholder } from "@/components/PhasePlaceholder";
import { getI18n } from "@/i18n/requestLocale";
import { requirePageUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/** Planned destination (work item 1.8): the shell link exists, the feature is built in its own phase. */
export default async function CalendarPage() {
  await requirePageUser();
  const { dict } = await getI18n();
  return <PhasePlaceholder dest="calendar" dict={dict} />;
}
