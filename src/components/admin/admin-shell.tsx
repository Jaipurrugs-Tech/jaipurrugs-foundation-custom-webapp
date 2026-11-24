"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRightFromSquare,
  Bars,
  Bell,
  Briefcase,
  ChartColumn,
  Comment,
  Comments,
  CreditCard,
  FileText,
  Gear,
  HandOk,
  House,
  LayoutSideContentLeft,
  MapPin,
  Person,
  Persons,
  PersonWorker,
  Receipt,
  SquareListUl,
  Suitcase,
  TagDollar,
  Wallet,
} from "@gravity-ui/icons";
import { Avatar, Button, Drawer, Dropdown, Header, Label, Separator, Toast } from "@heroui/react";
import { signOut } from "@/lib/actions/auth";
import { OrgLogo } from "@/components/ui/org-logo";

// `exact`: only highlight on that path itself, not its sub-pages (the Finance overview).
type NavItem = { href: string; label: string; icon: typeof House; exact?: boolean };

const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: House },
      { href: "/inbox", label: "Inbox", icon: Comment },
      { href: "/leads", label: "Leads", icon: Person },
      { href: "/templates", label: "WhatsApp Templates", icon: FileText },
      { href: "/agents", label: "AI Agent", icon: Comments },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/trips", label: "Trips", icon: Suitcase },
      { href: "/villages", label: "Villages", icon: MapPin },
      { href: "/partners", label: "Partners", icon: Briefcase },
      { href: "/facilitators", label: "Facilitators", icon: PersonWorker },
      { href: "/messaging", label: "Trip messages", icon: Bell },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/finance", label: "Overview", icon: ChartColumn, exact: true },
      { href: "/invoices", label: "Proforma invoices", icon: Receipt },
      { href: "/finance/invoices", label: "Tax invoices", icon: CreditCard },
      { href: "/finance/payouts", label: "Artisan payouts", icon: HandOk },
      { href: "/finance/expenses", label: "Expenses", icon: Wallet },
      { href: "/services", label: "Services", icon: TagDollar },
    ],
  },
  {
    items: [
      { href: "/team", label: "Team", icon: Persons },
      { href: "/forms", label: "Forms", icon: SquareListUl },
    ],
  },
];

// The desktop sidebar's collapsed state, remembered per browser. Read through useSyncExternalStore so the
// server render (and hydration) always uses "expanded" and the stored value applies right after.
const COLLAPSED_KEY = "jrf-admin-sidebar-collapsed";
const collapsedListeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked (private mode etc.): the in-memory state below still toggles.
  }
  collapsedListeners.forEach((listener) => listener());
}

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapsedListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useCollapsed(): [boolean, (value: boolean) => void] {
  const stored = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  // Keeps the toggle working when storage is unavailable.
  const [memory, setMemory] = useState<boolean | null>(null);
  const collapsed = memory ?? stored;
  return [
    collapsed,
    (value: boolean) => {
      setMemory(value);
      writeCollapsed(value);
    },
  ];
}

function CountBadge({ count, compact }: { count: number; compact?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} need attention`}
      className={`rounded-full bg-[#25d366] font-semibold leading-none text-white ${
        compact ? "absolute -right-1.5 -top-1.5 px-1 py-0.5 text-[9px]" : "ml-auto px-1.5 py-1 text-[10px]"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavLinks({
  pathname,
  collapsed,
  inboxCount,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  inboxCount: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="mb-2 flex flex-1 flex-col gap-1 text-sm">
      {NAV_GROUPS.map((group, index) => (
        <div key={group.label ?? index} className="flex flex-col gap-1">
          {group.label &&
            (collapsed ? (
              <Separator className="my-1" />
            ) : (
              <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {group.label}
              </p>
            ))}
          {group.items.map(({ href, label, icon: Icon, exact }) => {
            const isActive = pathname === href || (!exact && pathname.startsWith(`${href}/`));
            const badge = href === "/inbox" ? inboxCount : 0;
            return (
              <Link
                key={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                  collapsed ? "justify-center" : ""
                } ${
                  isActive
                    ? "bg-white font-medium text-neutral-900 shadow-sm"
                    : "text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-900"
                }`}
                href={href}
                title={collapsed ? label : undefined}
                onClick={onNavigate}
              >
                <span className="relative shrink-0">
                  <Icon className="size-[1.3rem]" />
                  {collapsed ? <CountBadge compact count={badge} /> : null}
                </span>
                {!collapsed && <span>{label}</span>}
                {!collapsed ? <CountBadge count={badge} /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function AccountMenu({ email, onNavigate }: { email: string; onNavigate?: () => void }) {
  const router = useRouter();
  return (
    <Dropdown>
      <Button isIconOnly aria-label="Account menu" className="w-fit self-start" variant="ghost">
        <Avatar size="sm">
          <Avatar.Fallback>{email.charAt(0).toUpperCase()}</Avatar.Fallback>
        </Avatar>
      </Button>
      <Dropdown.Popover placement="top start">
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "settings") {
              onNavigate?.();
              router.push("/settings");
            } else if (key === "sign-out") {
              signOut();
            }
          }}
        >
          <Dropdown.Section>
            <Header className="truncate">{email}</Header>
          </Dropdown.Section>
          <Separator />
          <Dropdown.Item id="settings" textValue="Settings">
            <Gear className="size-4 shrink-0 text-neutral-600" />
            <Label>Settings</Label>
          </Dropdown.Item>
          <Dropdown.Item
            className="text-danger data-[hovered]:text-danger"
            id="sign-out"
            textValue="Sign out"
            variant="danger"
          >
            <ArrowRightFromSquare className="size-4 shrink-0 text-danger" />
            <Label className="text-danger">Sign out</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function AdminShell({
  email,
  inboxCount = 0,
  children,
}: {
  email: string;
  /** WhatsApp conversations that are unread or waiting for a person (loaded in the admin layout). */
  inboxCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="flex h-dvh flex-col gap-2 overflow-hidden bg-neutral-100 p-2 md:flex-row">
      <Toast.Provider />

      {/* Phones: a slim top bar; the nav opens in a drawer. */}
      <header className="flex shrink-0 items-center justify-between gap-2 px-2 md:hidden">
        <Link aria-label="Dashboard" href="/dashboard">
          <OrgLogo className="h-6 w-auto" />
        </Link>
        <Button isIconOnly aria-label="Open menu" className="relative" variant="ghost" onPress={() => setDrawerOpen(true)}>
          <Bars className="size-5" />
          {inboxCount > 0 ? (
            <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#25d366]" />
          ) : null}
        </Button>
      </header>

      <Drawer.Backdrop isOpen={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Content placement="left">
          <Drawer.Dialog aria-label="Navigation" className="w-72 max-w-[85vw] bg-neutral-100 text-neutral-700">
            <Drawer.CloseTrigger />
            <Drawer.Header className="pb-2">
              <OrgLogo className="h-6 w-auto" />
            </Drawer.Header>
            <Drawer.Body className="flex flex-col">
              <NavLinks collapsed={false} inboxCount={inboxCount} pathname={pathname} onNavigate={closeDrawer} />
            </Drawer.Body>
            <Drawer.Footer className="justify-start">
              <AccountMenu email={email} onNavigate={closeDrawer} />
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      <aside
        className={`hidden shrink-0 flex-col gap-1 rounded-2xl bg-neutral-100 p-3 text-neutral-700 transition-[width] duration-200 md:flex ${
          collapsed ? "w-16 items-center" : "w-72"
        }`}
      >
        <div className={`mb-4 flex items-center gap-2 ${collapsed ? "flex-col" : "justify-between"}`}>
          {!collapsed && <OrgLogo className="h-6 w-auto" />}
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
            onClick={() => setCollapsed(!collapsed)}
            type="button"
          >
            <LayoutSideContentLeft className="size-4" />
          </button>
        </div>

        <NavLinks collapsed={collapsed} inboxCount={inboxCount} pathname={pathname} />

        <AccountMenu email={email} />
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-white p-4 shadow-[12px_0_32px_-8px_rgba(0,0,0,0.06),-12px_0_32px_-8px_rgba(0,0,0,0.06)] has-[.sticky]:p-0 md:h-full md:p-8">
        {children}
      </main>
    </div>
  );
}
