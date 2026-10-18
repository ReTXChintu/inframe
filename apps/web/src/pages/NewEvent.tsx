import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Mountain, PartyPopper, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { EventDetail, EventKind } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { emptyStorageChoice, StoragePicker, type StorageChoice } from "@/components/StoragePicker";
import { Button, Card, cx, TextField } from "@/components/ui";

const KINDS: { value: EventKind; label: string; icon: typeof Mountain }[] = [
  { value: "trip", label: "Trip", icon: Mountain },
  { value: "wedding", label: "Wedding", icon: Heart },
  { value: "party", label: "Party", icon: PartyPopper },
  { value: "other", label: "Other", icon: Sparkles },
];

const DRAFT_KEY = "inframe:new-event";

interface Draft {
  name: string;
  kind: EventKind;
  startsOn: string;
  endsOn: string;
  storage: StorageChoice;
}

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { name: "", kind: "trip", startsOn: "", endsOn: "", storage: emptyStorageChoice };
}

export function NewEventPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [params, setParams] = useSearchParams();
  // The Google consent screen is a full-page redirect: keep the form in sessionStorage.
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);

  useEffect(() => {
    const status = params.get("storage");
    if (!status) return;
    if (status === "connected") toast("Google Drive connected.");
    else if (status !== "cancelled") toast("Couldn't connect Google Drive. Try again.", "error");
    setParams({}, { replace: true });
    qc.invalidateQueries({ queryKey: ["connections"] });
  }, [params, setParams, toast, qc]);

  const create = useMutation({
    mutationFn: () =>
      api<{ event: EventDetail }>("/api/events", {
        body: {
          name: draft.name,
          kind: draft.kind,
          startsOn: draft.startsOn || null,
          endsOn: draft.endsOn || null,
          storage: {
            connectionId: draft.storage.connectionId,
            folder: draft.storage.mode === "existing" ? draft.storage.folder : null,
          },
        },
      }),
    onSuccess: ({ event }) => {
      sessionStorage.removeItem(DRAFT_KEY);
      qc.invalidateQueries({ queryKey: ["events"] });
      navigate(`/events/${event.id}?share=1`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else toast(errorMessage(err), "error");
    },
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const canSubmit =
    draft.name.trim() &&
    draft.storage.connectionId &&
    (draft.storage.mode === "new" || draft.storage.folder.trim());

  function submit(e: FormEvent) {
    e.preventDefault();
    setFields({});
    create.mutate();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div>
        <h1 className="text-3xl font-semibold">New event</h1>
        <p className="mt-1.5 text-[15px] text-muted">Everyone you invite can add photos. They're saved to your storage.</p>
      </div>

      {/* Wide screens: the event and its storage side by side. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">
          <span className="mr-2 text-muted">1</span>The event
        </h2>
        <TextField
          label="Name"
          placeholder="Goa with the gang"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          error={fields.name}
          maxLength={100}
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2" id="kind-label">
            Kind
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-labelledby="kind-label">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={draft.kind === k.value}
                onClick={() => set("kind", k.value)}
                className={cx(
                  "flex h-12 items-center justify-center gap-2 rounded-xl border text-[14px] font-medium transition-colors",
                  draft.kind === k.value ? "border-ink bg-ink text-bg" : "border-line hover:bg-surface-2",
                )}
              >
                <k.icon className="size-4" /> {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts (optional)" type="date" value={draft.startsOn} onChange={(e) => set("startsOn", e.target.value)} error={fields.startsOn} />
          <TextField
            label="Ends (optional)"
            type="date"
            value={draft.endsOn}
            min={draft.startsOn || undefined}
            onChange={(e) => set("endsOn", e.target.value)}
            error={fields.endsOn}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">
            <span className="mr-2 text-muted">2</span>Where photos are stored
          </h2>
          <p className="mt-1 text-[14px] text-muted">
            Photos go into your Google Drive or MEGA folder, with their thumbnails in a hidden “.inframe” sub-folder. InFrame
            keeps no copies of its own.
          </p>
        </div>
        <StoragePicker
          value={draft.storage}
          onChange={(storage) => set("storage", storage)}
          returnTo="/events/new"
          newFolderHint={`“InFrame · ${draft.name.trim() || "event name"}” in your storage.`}
        />
      </Card>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={!canSubmit} loading={create.isPending}>
          Create event
        </Button>
      </div>
    </form>
  );
}
