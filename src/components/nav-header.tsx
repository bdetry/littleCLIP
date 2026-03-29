"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Board" },
  { href: "/graph", label: "Graph" },
  { href: "/costs", label: "Costs" },
  { href: "/logs", label: "Logs" },
  { href: "", label: "" , separator: true },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
];

export function NavHeader({ taskCount }: { taskCount?: number }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-border/50">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">LittleCLIP</h1>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {

              const isSeparator = item.separator;
              if (isSeparator) {
                return <span key={item.href} className="h-4 w-px bg-border/50"></span>;
              }

              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {taskCount !== undefined && (
            <span className="font-mono text-xs text-muted-foreground">
              {taskCount} tasks
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
