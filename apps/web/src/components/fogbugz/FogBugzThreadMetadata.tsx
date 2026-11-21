import { T, Var } from "gt-react";
import type { FogBugzCase } from "@t3tools/contracts";
import { Badge } from "../ui/badge";

export function FogBugzThreadMetadata({ item }: { item: FogBugzCase }) {
  return (
    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-secondary-label">
      {item.priorityId !== undefined ? (
        <span className="shrink-0">
          <T>
            Prio <Var>{item.priorityId}</Var>
          </T>
        </span>
      ) : null}
      <span className="min-w-0 truncate">
        <Badge variant="secondary" size="sm">
          {item.status.replace(/^\d+\s*[.:-]?\s*/, "")}
        </Badge>
      </span>
    </div>
  );
}
