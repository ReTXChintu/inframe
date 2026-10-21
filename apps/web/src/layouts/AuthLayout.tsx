import { Link, Outlet } from "react-router";
import { Images, ScanFace, UsersRound } from "lucide-react";
import { AndroidAppLink } from "@/components/AndroidApp";
import { IconTile, Logo } from "@/components/ui";

/**
 * §6.2 sign-in layout: the brand panel (logo, headline, benefits and a small
 * product glimpse) beside the form panel. The panels wrap and stack below
 * ~1000 px; on phones the glimpse is dropped.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-wrap content-start bg-bg min-[1000px]:content-stretch">
      <section
        aria-label="About InFrame"
        className="flex min-w-0 flex-[1_1_520px] flex-col gap-8 border-b border-ln bg-sf2 px-4 py-6 sm:px-12 sm:py-10 min-[1000px]:border-r min-[1000px]:border-b-0"
      >
        <Link to="/" className="self-start rounded-md">
          <Logo />
        </Link>
        <div className="flex max-w-[560px] flex-col gap-6">
          <h2 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em] sm:text-display-l">
            Everyone shoots. You find yourself in seconds.
          </h2>
          <ul className="flex flex-col gap-4">
            <Benefit icon={<UsersRound />} title="One shared album per event">
              Trips, weddings and parties: everyone adds their photos to the same place.
            </Benefit>
            <Benefit icon={<ScanFace />} title="A selfie finds every photo you're in">
              Used only for matching, and never shown to other guests.
            </Benefit>
            <Benefit icon={<Images />} title="Originals stay in your storage">
              Photos live in your own Google Drive or MEGA folder. InFrame keeps no copies.
            </Benefit>
          </ul>
        </div>
        <Glimpse />
      </section>

      <main className="flex min-w-0 flex-[1_1_480px] flex-col items-center justify-center px-4 py-8 sm:px-12 sm:py-10">
        <div className="flex w-full max-w-[440px] flex-col gap-6">
          <Outlet />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-caption text-tx3">Photos stay in your own Google Drive or MEGA.</p>
            <AndroidAppLink label="Get the Android app" />
          </div>
        </div>
      </main>
    </div>
  );
}

function Benefit({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <IconTile tone="accent" size={36}>
        {icon}
      </IconTile>
      <div className="min-w-0">
        <p className="text-title-card">{title}</p>
        <p className="mt-0.5 text-body-s text-tx2">{children}</p>
      </div>
    </li>
  );
}

const tiles = [
  "#e9c9a8", "#2f3a4a", "#c4553b", "#8fa7a0", "#d9d2c3", "#4b3f5c",
  "#a8b8cc", "#e2a65a", "#30473c", "#c8a2a8", "#5d6b7a", "#ebe1cf",
];

/** A tiny contact sheet: the shared album, with the photo you're in picked out in the accent. */
function Glimpse() {
  return (
    <div aria-hidden className="mt-auto hidden max-w-[560px] rounded-xl border border-ln bg-sf p-4 shadow-1 sm:block">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-title-card">Goa with the gang</p>
        <span className="inline-flex h-6 items-center rounded-sm bg-ac-soft px-2 text-xs font-semibold text-ac">You're in 3</span>
      </div>
      <div className="grid grid-cols-6 gap-0.5 overflow-hidden rounded-md">
        {tiles.map((c, i) => (
          <div
            key={i}
            className="relative aspect-square"
            style={{ background: `linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 60%, #000))` }}
          >
            {(i === 3 || i === 7 || i === 10) && (
              <span className="absolute inset-0 shadow-[inset_0_0_0_2px_var(--ac)]">
                <span className="absolute right-1 bottom-1 rounded-xs bg-ac px-1 text-[10px] leading-[14px] font-semibold text-ac-tx">You</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
