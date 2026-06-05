import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  DocumentCodeIcon,
  TaskDaily01Icon,
  Home01Icon,
  ComputerIcon,
} from "@hugeicons/core-free-icons";
import { usePathname } from "next/navigation";

export function Header() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // After mounting, we can safely show the theme-dependent content
  useEffect(() => {
    setMounted(true);
  }, []);

  // Function to determine if a link is active
  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/";
    }
    return pathname?.startsWith(path);
  };

  // Get classes for navigation links based on active state
  const getLinkClasses = (path: string) => {
    const baseClasses =
      "flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 transition-colors";
    const activeClasses =
      "bg-bytebot-bronze-light-a3 text-bytebot-bronze-light-12";
    const inactiveClasses =
      "text-bytebot-bronze-dark-9 hover:bg-bytebot-bronze-light-a1 hover:text-bytebot-bronze-light-12";

    return `${baseClasses} ${isActive(path) ? activeClasses : inactiveClasses}`;
  };

  return (
    <header className="bg-background flex flex-col gap-3 border-b px-3 py-3 sm:px-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 md:gap-6">
        {/* Logo without link */}
        <div className="flex shrink-0 items-center">
          {mounted ? (
            <Image
              src={
                resolvedTheme === "dark"
                  ? "/bytebot_transparent_logo_white.svg"
                  : "/bytebot_transparent_logo_dark.svg"
              }
              alt="Bytebot Logo"
              width={100}
              height={30}
              className="h-8 w-auto"
            />
          ) : (
            <div className="h-8 w-[110px]" />
          )}
        </div>
        <div className="border-bytebot-bronze-dark-11 hidden h-5 border border-l-[0.5px] sm:block"></div>
        <nav
          aria-label="Primary navigation"
          className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 sm:mx-0 sm:gap-2 sm:px-0"
        >
          <Link href="/" className={getLinkClasses("/")}>
            <HugeiconsIcon icon={Home01Icon} className="h-4 w-4" />
            <span className="text-sm">Home</span>
          </Link>
          <Link href="/tasks" className={getLinkClasses("/tasks")}>
            <HugeiconsIcon icon={TaskDaily01Icon} className="h-4 w-4" />
            <span className="text-sm">Tasks</span>
          </Link>
          <Link href="/desktop" className={getLinkClasses("/desktop")}>
            <HugeiconsIcon icon={ComputerIcon} className="h-4 w-4" />
            <span className="text-sm">Desktop</span>
          </Link>
          <Link
            href="https://docs.bytebot.ai/quickstart"
            target="_blank"
            rel="noopener noreferrer"
            className={getLinkClasses("https://docs.bytebot.ai")}
          >
            <HugeiconsIcon icon={DocumentCodeIcon} className="h-4 w-4" />
            <span className="text-sm">Docs</span>
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-3"></div>
    </header>
  );
}
