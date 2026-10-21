import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, ImageUp, RefreshCw, SwitchCamera } from "lucide-react";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import type { Person } from "@/lib/types";
import { useFeedback } from "./feedback";
import { Button, ErrorBanner, FrameCorners, Modal, Spinner } from "./ui";

type Phase = "camera" | "review" | "saving";

/**
 * Take (or upload) one clear photo of a person's face and enrol it. The
 * server checks there's exactly one face, then finds every photo they're in.
 */
export function SelfieModal({ person, open, onClose }: { person: Person | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSelf = person?.kind === "self";

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    if (!open || phase !== "camera") return;
    let cancelled = false;
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser can't open the camera. Upload a photo instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setCameraError("Camera access was blocked. Allow it in your browser, or upload a photo instead."));
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, phase, facing, stop]);

  useEffect(() => {
    if (!open) {
      stop();
      setPhase("camera");
      setError(null);
      setShot((s) => {
        if (s) URL.revokeObjectURL(s.url);
        return null;
      });
    }
  }, [open, stop]);

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    // The preview is mirrored like a mirror; the saved frame is the camera's real view.
    ctx.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, size, size);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stop();
      setShot({ blob, url: URL.createObjectURL(blob) });
      setPhase("review");
      setError(null);
    }, "image/jpeg", 0.92);
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    stop();
    setShot({ blob: file, url: URL.createObjectURL(file) });
    setPhase("review");
    setError(null);
  }

  async function save() {
    if (!shot || !person) return;
    setPhase("saving");
    setError(null);
    const form = new FormData();
    form.append("file", shot.blob, "selfie.jpg");
    try {
      const res = await api<{ person: Person; matchCount: number }>(`/api/people/${person.id}/selfie`, { form });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["event"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["photos"] });
      toast(
        res.matchCount
          ? `${isSelf ? "You're" : `${person.name} is`} in ${plural(res.matchCount, "photo")} so far.`
          : `Saved. We'll find ${isSelf ? "you" : person.name} as photos come in.`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the selfie.");
      setPhase("review");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isSelf ? "Your selfie" : `Photo of ${person?.name ?? ""}`} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-body-l text-tx2">
          Face the camera in good light — no sunglasses or mask, and only {isSelf ? "you" : "them"} in the shot. It's used
          only to find {isSelf ? "your" : "their"} photos.
        </p>

        <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-stage">
          {phase === "camera" && !cameraError && (
            <video ref={video} autoPlay playsInline muted className="size-full object-cover" style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }} />
          )}
          {phase === "camera" && cameraError && (
            <div className="flex size-full items-center justify-center p-6 text-center text-body text-white/80">{cameraError}</div>
          )}
          {phase !== "camera" && shot && <img src={shot.url} alt="Selfie preview" className="size-full object-cover" />}
          {/* Viewfinder: frame corners + an oval guide */}
          <FrameCorners className="inset-3.5 text-white/90" />
          {phase === "camera" && !cameraError && (
            <div className="pointer-events-none absolute inset-[18%_22%] rounded-[50%] border-2 border-dashed border-white/60" />
          )}
          {phase === "saving" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 text-body font-medium text-white">
              <Spinner onDark /> Finding {isSelf ? "you" : person?.name} in photos…
            </div>
          )}
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex flex-wrap justify-center gap-2">
          {phase === "camera" ? (
            <>
              {!cameraError && (
                <Button size="lg" icon={<Camera className="size-5" />} onClick={capture}>
                  Take photo
                </Button>
              )}
              {!cameraError && (
                <Button variant="secondary" size="lg" aria-label="Switch camera" icon={<SwitchCamera className="size-5" />} onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} />
              )}
              <Button variant={cameraError ? "primary" : "ghost"} size="lg" icon={<ImageUp className="size-5" />} onClick={() => fileInput.current?.click()}>
                Upload instead
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="lg" icon={<RefreshCw className="size-4" />} onClick={() => setPhase("camera")} disabled={phase === "saving"}>
                Retake
              </Button>
              <Button size="lg" onClick={save} loading={phase === "saving"}>
                Use this photo
              </Button>
            </>
          )}
        </div>
        <input ref={fileInput} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      </div>
    </Modal>
  );
}
