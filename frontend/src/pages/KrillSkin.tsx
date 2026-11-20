/*
Render the default krill or an earned pixel sprite in the profile and dive scene.
Add artwork in public/skins using the reward's existing skin ID.
*/
import type { Skin } from "../shared/types";
import "./krill-skin.css";

export function KrillSkin({ skin }: { skin?: Skin | null }) {
  const id = skin?.id ?? "default";
  const src = id === "default" ? "/krill.png" : `/skins/${encodeURIComponent(id)}.png`;

  return (
    <span className="krill-skin" data-skin={id} aria-hidden="true">
      <img src={src} alt="" />
    </span>
  );
}
