import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Camera, Check, Images, Mail, Plus, ScanLine, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatRange, KIND_LABEL, plural, ROLE_LABEL } from "@/lib/format";
import type { EventSummary, MyInvite } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { TrippinChip } from "@/components/Trippin";
import { Badge, Button, Callout, Card, EmptyState, ErrorBanner, LinkButton, PageHeader, Spinner } from "@/components/ui";

/** Event cards fill the width: as many ~280 px columns as fit, never a narrow centred column. */
const CARD_GRID = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] sm:gap-5";

export function EventsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["events"],
    queryFn: () => api<{ events: EventSummary[] }>("/api/events"),
  });
  const events = data?.events ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your events"
        description="Trips, weddings and parties you're part of."
        actions={
          <>
            <LinkButton to="/join" variant="secondary" icon={<ScanLine className="size-[18px]" />}>
              Join with code
            </LinkButton>
            <LinkButton to="/events/new" icon={<Plus className="size-[18px]" />}>
              New event
            </LinkButton>
          </>
        }
      />

      <Invites />

      {isLoading ? (
        <div className={CARD_GRID} aria-busy="true" aria-label="Loading events">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-ln bg-sf">
              <div className="skeleton aspect-[4/3]" />
              <div className="flex flex-col gap-2 p-4">
                <div className="skeleton h-3 w-2/5 rounded-sm" />
                <div className="skeleton h-2.5 w-1/4 rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorBanner>{errorMessage(error)}</ErrorBanner>
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Camera />}
            title="No events yet"
            body="Create one for your next trip and invite everyone — or join a friend's event with their code."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton to="/events/new" size="lg" icon={<Plus className="size-[18px]" />}>
                  Create an event
                </LinkButton>
                <LinkButton to="/join" size="lg" variant="secondary">
                  I have a code
                </LinkButton>
              </div>
            }
          />
        </Card>
      ) : (
        <div className={CARD_GRID}>
          {events.map((e, i) => (
            <EventCard key={e.id} event={e} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event: e, index }: { event: EventSummary; index: number }) {
  const range = formatRange(e.startsOn, e.endsOn);
  return (
    <Link
      to={`/events/${e.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-ln bg-sf transition-colors duration-[120ms] hover:border-ln2 animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
    >
      {/* The cover is the hero: edge to edge, no overlays except the one fact that matters. */}
      <div className="relative aspect-[4/3] overflow-hidden bg-sunk">
        {e.coverUrl ? (
          <img
            src={e.coverUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 ease-ds group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-tx3">
            <Camera className="size-10" />
          </div>
        )}
        {e.myCount > 0 && (
          <span className="num absolute top-3 right-3 inline-flex h-6 items-center rounded-sm bg-ac px-2 text-xs font-semibold text-ac-tx">
            You're in {e.myCount}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="line-clamp-2 text-title-card text-tx">{e.name}</h2>
          {e.role !== "member" && <Badge>{ROLE_LABEL[e.role]}</Badge>}
        </div>
        <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-body-s text-tx3">
          <span>{KIND_LABEL[e.kind]}</span>
          {range && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden /> {range}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Images className="size-3.5" aria-hidden /> {plural(e.photoCount, "photo")}
          </span>
          <span className="inline-flex items-center gap-1" title={plural(e.memberCount, "member")}>
            <Users className="size-3.5" aria-hidden /> {e.memberCount}
          </span>
        </div>
        {(e.external || (e.storagePending && e.role === "owner")) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {e.storagePending && e.role === "owner" && <Badge tone="warn">Connect a folder</Badge>}
            {e.external && <TrippinChip link={e.external} plain />}
          </div>
        )}
      </div>
    </Link>
  );
}

function Invites() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useFeedback();
  const { data } = useQuery({ queryKey: ["invites"], queryFn: () => api<{ invites: MyInvite[] }>("/api/invites") });
  const invites = data?.invites ?? [];

  useEffect(() => {
    if (location.hash === "#invites") document.getElementById("invites")?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash, invites.length]);

  const accept = useMutation({
    mutationFn: (id: string) => api<{ eventId: string }>(`/api/invites/${id}/accept`, { method: "POST" }),
    onSuccess: ({ eventId }) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["invites"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      navigate(`/events/${eventId}`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/api/invites/${id}/decline`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invites"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  if (!invites.length) return null;
  return (
    <section id="invites" aria-label="Invitations" className="grid scroll-mt-24 gap-3 xl:grid-cols-2">
      {invites.map((inv) => (
        <Callout
          key={inv.id}
          tone="info"
          icon={<Mail />}
          className="animate-rise"
          title={`${inv.invitedBy ?? "Someone"} invited you to ${inv.eventName}`}
          action={
            <>
              <Button variant="ghost" size="sm" onClick={() => decline.mutate(inv.id)} disabled={decline.isPending}>
                Decline
              </Button>
              <Button
                size="sm"
                icon={<Check className="size-4" />}
                loading={accept.isPending && accept.variables === inv.id}
                onClick={() => accept.mutate(inv.id)}
              >
                Join
              </Button>
            </>
          }
        >
          {KIND_LABEL[inv.eventKind]}
          {formatRange(inv.startsOn, inv.endsOn) ? ` · ${formatRange(inv.startsOn, inv.endsOn)}` : ""}
          {inv.role === "cohost" ? " · as co-host" : ""}
        </Callout>
      ))}
    </section>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-24">
      <Spinner />
    </div>
  );
}
