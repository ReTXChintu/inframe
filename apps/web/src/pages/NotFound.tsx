import { Compass } from "lucide-react";
import { EmptyState, LinkButton } from "@/components/ui";

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="size-8" />}
      title="Out of frame"
      body="That page doesn't exist."
      action={<LinkButton to="/">Back to your events</LinkButton>}
    />
  );
}
