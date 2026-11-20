/*
This is the game's surface menu, with the shoreline above the room controls.
Edit it to change the menu scenery or layout. Copy it for another game menu over scenery.
*/

import type { ReactNode } from "react";
import { ReefScenery, SkyScenery } from "./PixelScenery";
import { OceanWildlife } from "./OceanWildlife";
import "./surface-menu.css";

export function SurfaceMenu({ title, lobby = false, children }: { title: ReactNode; lobby?: boolean; children: ReactNode }) {
  return (
    <section className={lobby ? "surface-menu surface-lobby" : "surface-menu"}>
      <div className="surface-scenery" aria-hidden="true">
        <div className="surface-sky">
          <SkyScenery />
        </div>
        <div className="surface-water">
          <ReefScenery surface />
          <div className="descent-waterline" />
          <div className="ocean-habitat surface-fish"><OceanWildlife habitat="reef" seed={17} /></div>
          <div className="ocean-habitat surface-ray"><OceanWildlife habitat="twilight" seed={54} /></div>
          <img className="surface-krill" src="/krill.png" alt="" />
        </div>
      </div>
      <div className="surface-title">{title}</div>
      <div className="surface-actions">{children}</div>
    </section>
  );
}
