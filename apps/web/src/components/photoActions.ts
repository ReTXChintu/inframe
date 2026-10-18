import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { errorMessage, useFeedback } from "./feedback";

/** Favourite / download / delete — shared by the selection bar and the viewer. */
export function usePhotoActions() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["photos"] });
    qc.invalidateQueries({ queryKey: ["event"] });
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["photo"] });
  };

  const favorite = useMutation({
    mutationFn: ({ ids, value }: { ids: string[]; value: boolean }) =>
      api("/api/photos/favorite", { body: { photoIds: ids, favorite: value } }),
    onSuccess: refresh,
    onError: (err) => toast(errorMessage(err), "error"),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ deleted: string[]; failed: { id: string; error: string }[] }>("/api/photos/delete", { body: { photoIds: ids } }),
    onSuccess: (res) => {
      refresh();
      if (res.failed.length) toast(`${plural(res.failed.length, "photo")} couldn't be deleted: ${res.failed[0]!.error}`, "error");
      else toast(`Deleted ${plural(res.deleted.length, "photo")}.`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  async function download(ids: string[]) {
    try {
      const { url } = await api<{ url: string }>("/api/downloads", { body: { photoIds: ids } });
      // A plain navigation lets the browser stream the ZIP straight to disk.
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.append(a);
      a.click();
      a.remove();
      toast(`Preparing ${plural(ids.length, "photo")}…`, "info");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function confirmDelete(ids: string[], onDone?: () => void) {
    const ok = await confirm({
      title: `Delete ${plural(ids.length, "photo")}?`,
      body: "They're removed for everyone in the event, and the files are moved to the trash of the event's Drive/MEGA folder.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) remove.mutate(ids, { onSuccess: () => onDone?.() });
  }

  return { favorite, remove, download, confirmDelete };
}
