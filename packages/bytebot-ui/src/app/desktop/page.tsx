"use client";

import React from "react";
import { Header } from "@/components/layout/Header";
import { DesktopContainer } from "@/components/ui/desktop-container";

export default function DesktopPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden">
      <Header />

      <main className="flex flex-1 overflow-y-auto px-3 py-4 sm:px-4 lg:overflow-hidden">
        <div className="flex min-h-full w-full items-center justify-center">
          {/* Main container */}
          <div className="w-full max-w-6xl lg:w-[72%] xl:w-[64%]">
            <DesktopContainer viewOnly={false} status="live_view">
              {/* No action buttons for desktop page */}
            </DesktopContainer>
          </div>
        </div>
      </main>
    </div>
  );
}
