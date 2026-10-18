import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailX } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { plural } from "@/lib/format";
import type { EventPreview } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { EmptyState, LinkButton } from "@/components/ui";
import { LoadingBlock } from "./Events";
import { EventInviteCard } from "./Join";

/** Landing page for the link in an invite email. */
export function InvitePage() {
  const { token = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const q = useQuery({
    queryKey: ["invite-token", token],
    queryFn: () =>
      api<{ invite: { id: string; role: "cohost" | "member"; email: string; forYou: boolean }; event: EventPreview; isMember: boolean }>(
        `/api/invites/token/${encodeURIComponent(token)}`,
      ),
  });
  const accept = useMutation({
    mutationFn: () => api<{ eventId: string; matched: number }>(`/api/invites/token/${encodeURIComponent(token)}/accept`, { method: "POST" }),
    onSuccess: ({ eventId, matched }) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      if (matched) toast(`Welcome! You're already in ${plural(matched, "photo")}.`);
      navigate(`/events/${eventId}`, { replace: true });
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error || !q.data) {
    return (
      <EmptyState
        icon={<MailX className="size-8" />}
        title="This invite isn't valid any more"
        body="It may have expired or already been used. Ask the host to send a new one."
        action={<LinkButton to="/" variant="secondary">Go to your events</LinkButton>}
      />
    );
  }
  const { invite, event, isMember } = q.data;
  const note = [
    invite.role === "cohost" ? "You're invited as a co-host: you'll be able to manage photos, albums and guests." : null,
    !invite.forYou ? `This invite was sent to ${invite.email}. You're signed in as ${user?.email} — accepting adds this account.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return <EventInviteCard event={event} isMember={isMember} onJoin={() => accept.mutate()} joining={accept.isPending} note={note || undefined} />;
}
