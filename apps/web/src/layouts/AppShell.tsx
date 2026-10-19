import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Images, LayoutGrid, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { connectSocket, disconnectSocket, useSocketEvent } from "@/lib/socket";
import { plural } from "@/lib/format";
import { useFeedback } from "@/components/feedback";
import { AndroidAppLink } from "@/components/AndroidApp";
import { Avatar, cx, Logo } from "@/components/ui";

const NAV = [
  { to: "/", label: "Events", icon: LayoutGrid, end: true },
  { to: "/photos", label: "My photos", icon: Images, end: false },
  { to: "/people", label: "People", icon: Users, end: false },
];

export function AppShell() {
  const { me, signOut } = useAuth();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    connectSocket();
    return () => disconnectSocket();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // New photos of you arrive in bursts (a whole upload batch): collect them
  // for a moment, then show one toast per event.
  const pendingMatches = useRef(new Map<string, number>());
  const flushTimer = useRef<number | undefined>(undefined);
  useSocketEvent<{ eventId: string; photoId: string }>("photo:matched", ({ eventId }) => {
    pendingMatches.current.set(eventId, (pendingMatches.current.get(eventId) ?? 0) + 1);
    qc.invalidateQueries({ queryKey: ["photos"] });
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["event", eventId] });
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      for (const [id, n] of pendingMatches.current) {
        const onThatEvent = window.location.pathname === `/events/${id}`;
        if (!onThatEvent) {
          toast(`You're in ${plural(n, "new photo")}`, "info", { label: "View", run: () => navigate(`/events/${id}?view=me`) });
        }
      }
      pendingMatches.current.clear();
    }, 2500);
  });
  useSocketEvent("invites:changed", () => {
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["invites"] });
  });
  useSocketEvent<{ eventId: string }>("event:removed", ({ eventId }) => {
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.removeQueries({ queryKey: ["event", eventId] });
    if (window.location.pathname.startsWith(`/events/${eventId}`)) {
      toast("You're no longer a member of that event.", "info");
      navigate("/");
    }
  });

  const user = me?.user;
  const invites = me?.pendingInvites ?? 0;

  return (
    <div className="min-h-dvh pb-20 sm:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="flex h-16 items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="InFrame home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
            {[...NAV, ...(user?.isAdmin ? [{ to: "/admin", label: "Admin", icon: ShieldCheck, end: false }] : [])].map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    "rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors",
                    isActive ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <AndroidAppLink className="mr-2 hidden md:inline-flex" />
            <Link
              to="/#invites"
              aria-label={invites ? `${plural(invites, "pending invite")}` : "Invites"}
              className="relative inline-flex size-10 items-center justify-center rounded-full hover:bg-surface-2"
            >
              <Bell className="size-5" />
              {invites > 0 && (
                <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-4 font-bold text-accent-ink">
                  {invites}
                </span>
              )}
            </Link>
            <div className="relative" ref={menuRef}>
              <button
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                onClick={() => setMenuOpen((o) => !o)}
                className="rounded-full p-1 hover:bg-surface-2"
              >
                <Avatar name={user?.name ?? "?"} src={me?.self?.selfieUrl} size={32} />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-xl animate-pop">
                  <div className="px-3 py-2.5">
                    <p className="truncate font-medium">{user?.name}</p>
                    <p className="truncate text-[13px] text-muted">{user?.email}</p>
                  </div>
                  <div className="my-1 h-px bg-line" />
                  <MenuLink to="/settings" icon={<Settings className="size-4" />} onPick={() => setMenuOpen(false)}>
                    Settings &amp; storage
                  </MenuLink>
                  {user?.isAdmin && (
                    <MenuLink to="/admin" icon={<ShieldCheck className="size-4" />} onPick={() => setMenuOpen(false)}>
                      Admin settings
                    </MenuLink>
                  )}
                  <AndroidAppLink
                    label="Get the Android app"
                    className="h-auto w-full justify-start rounded-xl border-0 bg-transparent px-3 py-2.5 text-[14px] font-normal hover:bg-surface-2"
                  />
                  <button
                    role="menuitem"
                    onClick={() => signOut().then(() => navigate("/login"))}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-danger hover:bg-surface-2"
                  >
                    <LogOut className="size-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Outlet />
      </main>

      {/* Phone: bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 pb-safe backdrop-blur-md sm:hidden"
      >
        {[...NAV, { to: "/settings", label: "Settings", icon: Settings, end: false }].map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", isActive ? "text-ink" : "text-muted")
            }
          >
            {({ isActive }) => (
              <>
                <span className={cx("rounded-full px-4 py-1 transition-colors", isActive && "bg-surface-2")}>
                  <n.icon className="size-5" />
                </span>
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function MenuLink({ to, icon, children, onPick }: { to: string; icon: React.ReactNode; children: React.ReactNode; onPick: () => void }) {
  return (
    <Link role="menuitem" to={to} onClick={onPick} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] hover:bg-surface-2">
      {icon}
      {children}
    </Link>
  );
}
