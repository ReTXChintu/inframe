import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Images, LayoutGrid, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { connectSocket, disconnectSocket, useSocketEvent } from "@/lib/socket";
import { plural } from "@/lib/format";
import { useFeedback } from "@/components/feedback";
import { AndroidAppLink } from "@/components/AndroidApp";
import { Avatar, cx, IconButton, Logo } from "@/components/ui";

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; end: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Events", icon: LayoutGrid, end: true },
  { to: "/photos", label: "My photos", icon: Images, end: false },
  { to: "/people", label: "People", icon: Users, end: false },
];

/**
 * The shared shell (design system §6): a 248 px sidebar on desktop, a top bar
 * with inline nav on tablets, and a bottom tab bar on phones. Content is always
 * full width; photo grids bleed to the edges of the content area.
 */
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
  const adminItem: NavItem[] = user?.isAdmin ? [{ to: "/admin", label: "Admin", icon: ShieldCheck, end: false }] : [];
  const invitesLabel = invites ? `${plural(invites, "pending invite")}` : "Invites";
  const doSignOut = () => signOut().then(() => navigate("/login"));

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop: sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-ln bg-sf px-3 py-5 lg:flex">
        <Link to="/" aria-label="InFrame home" className="mb-3 self-start rounded-md px-2">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <SideLink key={n.to} item={n} />
          ))}
          <Link
            to="/#invites"
            aria-label={invitesLabel}
            className="flex h-10 items-center gap-3 rounded-md px-3 text-[14px] font-medium text-tx2 transition-colors hover:bg-sf2 hover:text-tx"
          >
            <Bell className="size-5" aria-hidden />
            <span className="flex-1">Invites</span>
            {invites > 0 && <CountBadge n={invites} />}
          </Link>
        </nav>
        <div className="flex-1" />
        <nav aria-label="Account" className="flex flex-col gap-1">
          {[...adminItem, { to: "/settings", label: "Settings", icon: Settings, end: false }].map((n) => (
            <SideLink key={n.to} item={n} />
          ))}
        </nav>
        <AndroidAppLink label="Get the Android app" look="menu" />
        <div className="mt-3 flex items-center gap-2.5 border-t border-ln px-1 pt-3">
          <Avatar name={user?.name ?? "?"} src={me?.self?.selfieUrl} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-tx">{user?.name}</p>
            <p className="truncate text-caption text-tx3">{user?.email}</p>
          </div>
          <IconButton label="Sign out" onClick={doSignOut}>
            <LogOut className="size-5" />
          </IconButton>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-20 sm:pb-0">
        {/* Phone and tablet: top app bar */}
        <header className="sticky top-0 z-30 border-b border-ln bg-bg lg:hidden">
          <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
            <Link to="/" aria-label="InFrame home" className="rounded-md">
              <Logo />
            </Link>
            <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
              {[...NAV, ...adminItem].map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cx(
                      "inline-flex h-10 items-center rounded-md px-3 text-[14px] transition-colors",
                      isActive ? "bg-ac-soft font-semibold text-ac" : "font-medium text-tx2 hover:bg-sf2 hover:text-tx",
                    )
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <Link
                to="/#invites"
                aria-label={invitesLabel}
                className="relative inline-flex size-10 items-center justify-center rounded-full text-tx2 hover:bg-sf2 hover:text-tx"
              >
                <Bell className="size-5" />
                {invites > 0 && <CountBadge n={invites} className="absolute -top-0.5 -right-0.5" />}
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="rounded-full p-0.5 hover:bg-sf2"
                >
                  <Avatar name={user?.name ?? "?"} src={me?.self?.selfieUrl} size={36} />
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 mt-2 w-64 rounded-xl border border-ln bg-sf p-1.5 shadow-2 animate-pop">
                    <div className="px-3 py-2.5">
                      <p className="truncate text-[14px] font-medium">{user?.name}</p>
                      <p className="truncate text-caption text-tx3">{user?.email}</p>
                    </div>
                    <div className="my-1 h-px bg-ln" />
                    <MenuLink to="/settings" icon={<Settings className="size-[18px]" />} onPick={() => setMenuOpen(false)}>
                      Settings &amp; storage
                    </MenuLink>
                    {user?.isAdmin && (
                      <MenuLink to="/admin" icon={<ShieldCheck className="size-[18px]" />} onPick={() => setMenuOpen(false)}>
                        Admin settings
                      </MenuLink>
                    )}
                    <AndroidAppLink label="Get the Android app" look="menu" />
                    <button
                      role="menuitem"
                      onClick={doSignOut}
                      className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[14px] text-crit hover:bg-crit-soft"
                    >
                      <LogOut className="size-[18px]" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 pt-5 pb-12 sm:px-6 sm:pt-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      {/* Phone: bottom tab bar (§6.3) */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-ln bg-sf pb-safe sm:hidden"
      >
        {[...NAV, { to: "/settings", label: "Settings", icon: Settings, end: false }].map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx("flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold", isActive ? "text-ac" : "text-tx2")
            }
          >
            {({ isActive }) => (
              <>
                <span className={cx("flex h-8 w-14 items-center justify-center rounded-2xl transition-colors duration-200", isActive && "bg-ac-soft")}>
                  <n.icon className="size-6" />
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

function SideLink({ item: n }: { item: NavItem }) {
  return (
    <NavLink
      to={n.to}
      end={n.end}
      className={({ isActive }) =>
        cx(
          "flex h-10 items-center gap-3 rounded-md px-3 text-[14px] transition-colors",
          isActive ? "bg-ac-soft font-semibold text-ac" : "font-medium text-tx2 hover:bg-sf2 hover:text-tx",
        )
      }
    >
      <n.icon className="size-5" />
      {n.label}
    </NavLink>
  );
}

/** §7.4 count badge: 20 h, min-width 22, --crit-fill with white 11/600. */
function CountBadge({ n, className }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "num inline-flex h-5 min-w-[22px] items-center justify-center rounded-[10px] bg-crit-fill px-1.5 text-[11px] font-semibold text-white",
        className,
      )}
    >
      {n}
    </span>
  );
}

function MenuLink({ to, icon, children, onPick }: { to: string; icon: ReactNode; children: ReactNode; onPick: () => void }) {
  return (
    <Link role="menuitem" to={to} onClick={onPick} className="flex h-11 items-center gap-3 rounded-md px-3 text-[14px] text-tx hover:bg-sf2">
      {icon}
      {children}
    </Link>
  );
}
