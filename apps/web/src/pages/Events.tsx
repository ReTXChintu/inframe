import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Camera, Check, Mail, Plus, ScanLine, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatRange, KIND_LABEL, plural, ROLE_LABEL } from "@/lib/format";
import type { EventSummary, MyInvite } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, Spinner, LinkButton } from "@/components/ui";

export function EventsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["events"],
    queryFn: () => api<{ events: EventSummary[] }>("/api/events"),
  });
  const events = data?.events ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">Your events</h1>
          <p className="mt-1.5 text-[15px] text-muted">Trips, weddings and parties you're part of.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton to="/join" variant="secondary" icon={<ScanLine className="size-4" />}>
              Join with code
            </LinkButton>
          <LinkButton to="/events/new" icon={<Plus className="size-4" />}>New event</LinkButton>
        </div>
      </div>

      <Invites />

      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton aspect-[4/3] rounded-[18px]" />
          ))}
        </div>
      ) : error ? (
        <p className="text-danger">{errorMessage(error)}</p>
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Camera className="size-8" />}
            title="No events yet"
            body="Create one for your next trip and invite everyone — or join a friend's event with their code."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton to="/events/new" icon={<Plus className="size-4" />}>Create an event</LinkButton>
                <LinkButton to="/join" variant="secondary">I have a code</LinkButton>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
      className="group overflow-hidden rounded-[18px] border border-line bg-surface transition-shadow hover:shadow-lg animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="frame relative aspect-[4/3] overflow-hidden bg-surface-2 text-white [--frame-inset:12px] [--frame-len:22px]">
        {e.coverUrl ? (
          <img src={e.coverUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted">
            <Camera className="size-10" strokeWidth={1.5} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/50 to-transparent" />
        {e.myCount > 0 && (
          <span className="absolute top-4 right-4 rotate-2 rounded-full bg-accent px-2.5 py-1 text-[12px] font-bold text-accent-ink shadow">
            You're in {e.myCount}
          </span>
        )}
        <span className="absolute bottom-3.5 left-4 text-[12px] font-semibold tracking-[0.14em] text-white/90 uppercase">
          {KIND_LABEL[e.kind]}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="line-clamp-2 text-lg font-semibold">{e.name}</h2>
          {e.role !== "member" && <Badge>{ROLE_LABEL[e.role]}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
          {range && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" /> {range}
            </span>
          )}
          <span>{plural(e.photoCount, "photo")}</span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" /> {e.memberCount}
          </span>
        </div>
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
    <section id="invites" aria-label="Invitations" className="flex flex-col gap-3">
      {invites.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-col gap-3 rounded-[18px] border border-accent/30 bg-accent-soft p-4 sm:flex-row sm:items-center animate-rise"
        >
          <Mail className="size-5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {inv.invitedBy ?? "Someone"} invited you to {inv.eventName}
            </p>
            <p className="text-[13px] text-ink-2">
              {KIND_LABEL[inv.eventKind]}
              {formatRange(inv.startsOn, inv.endsOn) ? ` · ${formatRange(inv.startsOn, inv.endsOn)}` : ""}
              {inv.role === "cohost" ? " · as co-host" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => decline.mutate(inv.id)} disabled={decline.isPending}>
              Decline
            </Button>
            <Button size="sm" icon={<Check className="size-4" />} loading={accept.isPending && accept.variables === inv.id} onClick={() => accept.mutate(inv.id)}>
              Join
            </Button>
          </div>
        </div>
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
