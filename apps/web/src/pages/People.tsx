import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Pencil, Plus, ScanFace, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import type { Person } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { SelfieModal } from "@/components/SelfieCapture";
import { Avatar, Badge, Button, Card, IconButton, LinkButton, Modal, Spinner, TextField } from "@/components/ui";

/** You + family members, each with the selfie InFrame searches for. */
export function PeoplePage() {
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { data, isLoading } = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: Person[] }>("/api/people").then((r) => r.people) });
  const [selfieFor, setSelfieFor] = useState<Person | null>(null);
  const [editing, setEditing] = useState<Person | "new" | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["people"] });
    qc.invalidateQueries({ queryKey: ["event"] });
    qc.invalidateQueries({ queryKey: ["photos"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  const removePerson = useMutation({
    mutationFn: (id: string) => api(`/api/people/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const clearSelfie = useMutation({
    mutationFn: (id: string) => api(`/api/people/${id}/selfie`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (err) => toast(errorMessage(err), "error"),
  });

  if (isLoading || !data) return <Spinner />;
  const self = data.find((p) => p.kind === "self");
  const family = data.filter((p) => p.kind === "family");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold sm:text-4xl">{welcome ? "Welcome to InFrame" : "People"}</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          {welcome
            ? "One last step: add a selfie so we can find the photos you're in. You can skip it and do it later."
            : "InFrame finds these faces in every event you're part of. Selfies are only used for matching and never shown to other guests."}
        </p>
      </div>

      {self && (
        <Card className="frame p-5 sm:p-6 [--frame-inset:10px] [--frame-color:var(--line)]">
          <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
            <Avatar name={self.name} src={self.selfieUrl} size={96} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold tracking-[0.14em] text-accent uppercase">You</p>
              <h2 className="text-2xl font-semibold">{self.name}</h2>
              <p className="mt-1 text-[14px] text-muted">
                {self.hasSelfie ? `Found in ${plural(self.matchCount, "photo")} so far.` : "No selfie yet — we can't find your photos without one."}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button icon={<Camera className="size-4" />} onClick={() => setSelfieFor(self)}>
                {self.hasSelfie ? "Retake selfie" : "Take a selfie"}
              </Button>
              {self.hasSelfie && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (await confirm({ title: "Remove your selfie?", body: "You'll stop being matched in photos until you add a new one.", confirmLabel: "Remove", danger: true })) clearSelfie.mutate(self.id);
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Family</h2>
          <p className="text-[14px] text-muted">Kids, parents, partner — find their photos too, even if they don't have an account.</p>
        </div>
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
          Add
        </Button>
      </div>

      {family.length === 0 ? (
        <button
          onClick={() => setEditing("new")}
          className="flex items-center justify-center gap-3 rounded-[18px] border-2 border-dashed border-line px-6 py-10 text-[15px] font-medium text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ScanFace className="size-6" /> Add a family member
        </button>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {family.map((p) => (
            <li key={p.id}>
              <Card className="flex items-center gap-4 p-4">
                <Avatar name={p.name} src={p.selfieUrl} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="truncate text-[13px] text-muted">
                    {p.relation ? `${p.relation} · ` : ""}
                    {p.hasSelfie ? plural(p.matchCount, "photo") : "No photo yet"}
                  </p>
                  {!p.hasSelfie && (
                    <button onClick={() => setSelfieFor(p)} className="mt-1 text-[13px] font-semibold text-accent hover:underline">
                      Add their photo
                    </button>
                  )}
                </div>
                <div className="flex">
                  {p.hasSelfie && (
                    <IconButton label={`New photo of ${p.name}`} onClick={() => setSelfieFor(p)}>
                      <Camera className="size-4" />
                    </IconButton>
                  )}
                  <IconButton label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Remove ${p.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${p.name}?`, body: "Their photo and matches are deleted. Photos themselves stay in the events.", confirmLabel: "Remove", danger: true })) removePerson.mutate(p.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {welcome && (
        <div className="flex justify-center gap-2 pt-2">
          <LinkButton to="/" variant={self?.hasSelfie ? "primary" : "ghost"} size="lg">
            {self?.hasSelfie ? "Go to my events" : "Skip for now"}
          </LinkButton>
        </div>
      )}

      <SelfieModal person={selfieFor} open={Boolean(selfieFor)} onClose={() => setSelfieFor(null)} />
      <PersonEditor
        person={editing}
        onClose={() => setEditing(null)}
        onCreated={(p) => {
          setEditing(null);
          setSelfieFor(p);
        }}
      />
    </div>
  );
}

function PersonEditor({ person, onClose, onCreated }: { person: Person | "new" | null; onClose: () => void; onCreated: (p: Person) => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const isNew = person === "new";
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [lastPerson, setLastPerson] = useState<typeof person>(null);
  if (person !== lastPerson) {
    // Reset the form when a different person is opened.
    setLastPerson(person);
    setName(person && person !== "new" ? person.name : "");
    setRelation(person && person !== "new" ? (person.relation ?? "") : "");
  }

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? api<{ person: Person }>("/api/people", { body: { name, relation } })
        : api<{ person: Person }>(`/api/people/${(person as Person).id}`, { method: "PATCH", body: { name, relation } }),
    onSuccess: ({ person: saved }) => {
      qc.invalidateQueries({ queryKey: ["people"] });
      if (isNew) onCreated(saved);
      else onClose();
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  return (
    <Modal
      open={person !== null}
      onClose={onClose}
      title={isNew ? "Add family member" : "Edit"}
      size="sm"
      footer={
        <Button onClick={() => save.mutate()} disabled={!name.trim()} loading={save.isPending}>
          {isNew ? "Next: add their photo" : "Save"}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        <TextField label="Relation (optional)" placeholder="Daughter, Mum…" value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={40} />
        {!isNew && <Badge className="self-start">Changing the photo is done from the camera button.</Badge>}
      </form>
    </Modal>
  );
}
