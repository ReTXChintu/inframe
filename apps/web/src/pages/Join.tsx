import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Images, Info, ScanLine, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatRange, KIND_LABEL, plural } from "@/lib/format";
import type { EventPreview } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { Button, Callout, Card, EmptyState, IconTile, LinkButton } from "@/components/ui";
import { LoadingBlock } from "./Events";

const LEN = 8;
const ALLOWED = /[A-HJ-NP-Z2-9]/; // matches the server's alphabet (no 0/O, 1/I/L)

/** Eight boxes, auto-advancing; accepts paste of a code or a whole invite link. */
export function JoinCodePage() {
  const navigate = useNavigate();
  const [chars, setChars] = useState<string[]>(Array(LEN).fill(""));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const fill = (raw: string, from = 0) => {
    // A pasted link: take the code after /join/
    const fromLink = raw.match(/\/join\/([A-Za-z0-9-]+)/)?.[1];
    const clean = (fromLink ?? raw).toUpperCase().replace(/[^A-Z0-9]/g, "").split("").filter((c) => ALLOWED.test(c));
    if (!clean.length) return;
    setChars((prev) => {
      const next = [...prev];
      clean.slice(0, LEN - from).forEach((c, i) => (next[from + i] = c));
      const nextEmpty = next.findIndex((c) => !c);
      boxes.current[nextEmpty === -1 ? LEN - 1 : nextEmpty]?.focus();
      return next;
    });
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !chars[i] && i > 0) {
      boxes.current[i - 1]?.focus();
      setChars((p) => p.map((c, j) => (j === i - 1 ? "" : c)));
    } else if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < LEN - 1) boxes.current[i + 1]?.focus();
  };

  const code = chars.join("");
  return (
    <Card className="grid gap-6 p-5 sm:p-8 lg:grid-cols-2 lg:items-center lg:gap-10">
      <div className="flex flex-col gap-4">
        <IconTile tone="accent" size={48}>
          <ScanLine />
        </IconTile>
        <div>
          <h1 className="text-title-page">Join an event</h1>
          <p className="mt-1.5 text-body-l text-tx2">
            Enter the 8-character code from the host, or paste their invite link. Scanning the QR opens the link directly.
          </p>
        </div>
      </div>
      <form
        className="flex w-full flex-col items-start gap-5 lg:border-l lg:border-ln lg:pl-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === LEN) navigate(`/join/${code}`);
        }}
      >
        <div className="flex items-center gap-1.5 sm:gap-2" role="group" aria-label="Join code">
          {chars.map((c, i) => (
            <span key={i} className="contents">
              {i === 4 && <span className="text-[22px] text-tx3" aria-hidden>–</span>}
              <input
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                value={c}
                aria-label={`Character ${i + 1}`}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={1}
                autoFocus={i === 0}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  if (!v) return setChars((p) => p.map((x, j) => (j === i ? "" : x)));
                  fill(v, i);
                }}
                onKeyDown={(e) => onKey(i, e)}
                onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
                  e.preventDefault();
                  fill(e.clipboardData.getData("text"), i);
                }}
                className="h-13 w-9 rounded-md border border-ln2 bg-sf text-center font-mono text-[22px] font-medium text-tx uppercase outline-none transition-colors focus:border-2 focus:border-ac sm:w-11"
              />
            </span>
          ))}
        </div>
        <Button type="submit" size="lg" disabled={code.length !== LEN}>
          Continue
        </Button>
      </form>
    </Card>
  );
}

export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const preview = useQuery({
    queryKey: ["join", code],
    queryFn: () => api<{ event: EventPreview; isMember: boolean }>(`/api/join/${encodeURIComponent(code)}`),
  });
  const join = useMutation({
    mutationFn: () => api<{ eventId: string; matched: number }>(`/api/join/${encodeURIComponent(code)}`, { method: "POST" }),
    onSuccess: ({ eventId, matched }) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      if (matched) toast(`Welcome! You're already in ${plural(matched, "photo")}.`);
      navigate(`/events/${eventId}`, { replace: true });
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  if (preview.isLoading) return <LoadingBlock />;
  if (preview.error || !preview.data) {
    return (
      <EmptyState
        icon={<ScanLine className="size-8" />}
        title="That code doesn't work"
        body="It may be mistyped, or the host turned off joining by code or made a new one."
        action={<LinkButton to="/join" variant="secondary">Try another code</LinkButton>}
      />
    );
  }
  const { event, isMember } = preview.data;
  return <EventInviteCard event={event} isMember={isMember} onJoin={() => join.mutate()} joining={join.isPending} />;
}

export function EventInviteCard({
  event,
  isMember,
  onJoin,
  joining,
  note,
}: {
  event: EventPreview;
  isMember: boolean;
  onJoin: () => void;
  joining: boolean;
  note?: string;
}) {
  const range = formatRange(event.startsOn, event.endsOn);
  return (
    <Card className="grid overflow-hidden lg:grid-cols-[3fr_2fr]">
      {/* Like the sign-in brand panel: --sf2, the accent mark, the event as the headline. */}
      <div className="flex flex-col justify-end gap-4 border-b border-ln bg-sf2 px-5 pt-8 pb-6 sm:px-10 sm:pb-8 lg:min-h-[320px] lg:border-r lg:border-b-0">
        <IconTile tone="accent" size={48}>
          <Images />
        </IconTile>
        <div>
          <p className="text-label text-tx2">{KIND_LABEL[event.kind]}</p>
          <h1 className="mt-1 text-display-s break-words sm:text-display-m">{event.name}</h1>
          <p className="mt-1.5 text-body-l text-tx2">Hosted by {event.ownerName}</p>
        </div>
      </div>
      <div className="flex flex-col justify-center gap-5 p-5 sm:p-8">
        <div className="num flex flex-wrap gap-x-5 gap-y-1 text-body text-tx2">
          {range && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-[18px] text-tx3" aria-hidden /> {range}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-[18px] text-tx3" aria-hidden /> {plural(event.memberCount, "member")}
          </span>
        </div>
        {note && <Callout tone="info" icon={<Info />}>{note}</Callout>}
        {isMember ? (
          <LinkButton to={`/events/${event.id}`} size="xl">
            You're in — open the event
          </LinkButton>
        ) : (
          <Button size="xl" onClick={onJoin} loading={joining}>
            Join {KIND_LABEL[event.kind].toLowerCase()}
          </Button>
        )}
        <p className="text-caption text-tx3">Members can see the shared album and find the photos they're in.</p>
      </div>
    </Card>
  );
}
