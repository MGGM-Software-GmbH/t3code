import {
  BugIcon,
  CalendarIcon,
  CircleHelpIcon,
  HeadsetIcon,
  LightbulbIcon,
  MailIcon,
  SearchIcon,
  TestTubeIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import type { FogBugzCase } from "@t3tools/contracts";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export function FogBugzCategoryIcon({ item }: { item: FogBugzCase }) {
  // Category overrides follow FogBugz's CategoryFAIconClassForCategory.
  const Icon =
    item.categoryId === 3
      ? MailIcon
      : item.categoryId === 6
        ? HeadsetIcon
        : item.categoryId === 8
          ? TestTubeIcon
          : [
              null,
              BugIcon,
              LightbulbIcon,
              CircleHelpIcon,
              CalendarIcon,
              BugIcon,
              WrenchIcon,
              SearchIcon,
              TestTubeIcon,
              TriangleAlertIcon,
            ][item.categoryIconType];
  if (!Icon) return null;
  const color =
    item.categoryId === 6
      ? "text-warning"
      : item.categoryIconType === 1 || item.categoryIconType === 5
        ? "text-destructive"
        : item.categoryIconType === 2
          ? "text-warning"
          : "text-info";
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={`mt-0.5 shrink-0 ${color}`} />}>
        <Icon className="size-4" aria-label={item.categoryName} />
      </TooltipTrigger>
      <TooltipPopup>{item.categoryName}</TooltipPopup>
    </Tooltip>
  );
}
