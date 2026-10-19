import { Link, Outlet } from "react-router";
import { AndroidAppLink } from "@/components/AndroidApp";
import { Logo } from "@/components/ui";

/** Split screen: form on the left, a framed "contact sheet" on the right (desktop). */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-4 py-6 sm:px-10 xl:px-16">
        <Link to="/" className="self-start">
          <Logo />
        </Link>
        <main className="flex w-full flex-1 flex-col justify-center py-10">
          <Outlet />
        </main>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Photos stay in your own Google Drive or MEGA.</p>
          <AndroidAppLink label="Get the Android app" />
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-ink lg:block" aria-hidden>
        <ContactSheet />
      </aside>
    </div>
  );
}

const tiles = [
  "#e9c9a8", "#2f3a4a", "#c4553b", "#8fa7a0", "#d9d2c3", "#4b3f5c",
  "#a8b8cc", "#e2a65a", "#30473c", "#c8a2a8", "#5d6b7a", "#ebe1cf",
];

function ContactSheet() {
  return (
    <div className="absolute inset-0 flex flex-col gap-8 p-12 text-bg">
      {/* The sheet bleeds off the bottom of its own area, never over the caption. */}
      <div className="relative -mx-12 -mt-12 min-h-0 flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-b from-transparent to-ink" />
      <div className="grid -rotate-3 grid-cols-4 gap-3 p-12 opacity-90">
        {tiles.map((c, i) => (
          <div
            key={i}
            className={i === 5 ? "frame aspect-[4/5] rounded-lg [--frame-color:var(--accent)] [--frame-inset:-7px] [--frame-len:20px]" : "aspect-[4/5] rounded-lg"}
            style={{ background: `linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 55%, #000))` }}
          >
            {i === 5 && (
              <div className="flex h-full items-end p-2">
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink">You</span>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>
      <div className="max-w-xl shrink-0">
        <p className="mb-3 flex items-center gap-2 text-[13px] tracking-[0.18em] text-bg/60 uppercase">
          <span className="rec-dot" /> Live at the event
        </p>
        <h2 className="text-4xl leading-[1.05] font-semibold">Everyone shoots. You find yourself in seconds.</h2>
        <p className="mt-4 text-[15px] text-bg/70">
          One shared album for the trip. Take a selfie and InFrame pulls out every photo you're in.
        </p>
      </div>
    </div>
  );
}
