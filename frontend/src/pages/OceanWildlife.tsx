/*
Draw animated ocean wildlife on the same pixel grid as the map.
Add a sprite or habitat here when expanding underwater scenery.
*/
import { useEffect, useRef } from "react";

type Species = "fish" | "ray" | "jelly" | "squid" | "angler" | "eel" | "isopod";
export type Habitat = "reef" | "twilight" | "midnight" | "abyss" | "vents" | "crystal" | "ruins";
type Sprite = { rows: string[]; colors: string[]; scale?: number };

const SPRITES: Record<Species, Sprite> = {
  fish: {
    rows: ["...11222.....", ".12233321...1", "1234333321.12", "1223333321122", ".122222211.12", "...11111....1"],
    colors: ["#21405c", "#407e8d", "#84cbbb", "#fff1b2"],
  },
  ray: {
    rows: [".......11........", "....1112211......", "..11223322211....", "112223443322211..", ".1122233332222111", "...111222211.1111", "......1111......."],
    colors: ["#233758", "#456c85", "#70a0ad", "#d1dcd0"], scale: 2,
  },
  jelly: {
    rows: ["....11111....", "..112333211..", ".12344433221.", "1234433333221", "1233333322221", ".11122222111.", "..2..2..2..2.", "..2..2..2..2.", ".....2.....2."],
    colors: ["#464368", "#807ca8", "#a99dd1", "#e0c7e4"],
  },
  squid: {
    rows: ["......12........", "...1122321......", ".1123333221.....", "12233343221.212.", ".122333322112..2", "...1123211..221.", "......11..21...2"],
    colors: ["#322847", "#85566f", "#af7183", "#efd69f"], scale: 2,
  },
  angler: {
    rows: ["..44.......", ".4241......", "..1..1.....", "...11221..1", ".1122322112", "12242223222", "11121122112", ".1414111..1", "..11111...."],
    colors: ["#292b4e", "#62587b", "#8b718f", "#e7e9b0"], scale: 2,
  },
  eel: {
    rows: ["...........1111.......", ".111111..112222111....", "112342211223332221111.", "1222222222333222211121", ".111112222222211....11", "......11111111........"],
    colors: ["#25283f", "#495578", "#7588a4", "#e1e5ba"], scale: 2,
  },
  isopod: {
    rows: ["...111111111....", "..12232232221...", ".12233333332211.", "1233332332332221", ".12222222222211.", "..1.1.1.1.1.1..."],
    colors: ["#342e46", "#655772", "#ad90a2", "#d7b7b0"],
  },
};

const POPULATIONS: Record<Habitat, Species[]> = {
  reef: ["fish", "fish", "fish", "fish", "ray"],
  twilight: ["fish", "ray", "fish", "jelly", "squid"],
  midnight: ["squid", "jelly", "jelly", "eel"],
  abyss: ["angler", "jelly", "isopod", "eel"],
  vents: ["isopod", "eel", "isopod", "angler"],
  crystal: ["jelly", "jelly", "eel", "squid"],
  ruins: ["eel", "angler", "isopod", "squid"],
};

function sprite(ctx: CanvasRenderingContext2D, kind: Species, x: number, y: number, reverse: boolean, tick: number) {
  const { rows, colors, scale = 1 } = SPRITES[kind];
  const width = rows[0].length;
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row].length; column += 1) {
      const color = colors[Number(rows[row][column]) - 1];
      if (!color) continue;
      const fin = column >= width - 4 && tick % 4 >= 2;
      const pulse = kind === "jelly" && row >= 6 && tick % 5 >= 3;
      const offset = (reverse ? width - 1 - column : column) * scale;
      ctx.fillStyle = color;
      ctx.fillRect(x + offset + (pulse ? 1 : 0), y + (row + (fin ? 1 : 0)) * scale, scale, scale);
    }
  }
}

function animateWildlife(canvas: HTMLCanvasElement, habitat: Habitat, seed: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let animation = 0;
  let visible = false;
  let lastFrame = -Infinity;

  function paint(now: number) {
    if (!ctx) return;
    const { width, height } = canvas;
    const time = reduced.matches ? 0 : now / 1000;
    const tick = Math.floor(time * 12);
    ctx.clearRect(0, 0, width, height);
    const swimmers = POPULATIONS[habitat];
    swimmers.forEach((kind, index) => {
      const rightward = (index + seed) % 3 === 0;
      const stride = kind === "ray" || kind === "isopod" ? 4 : 7 + index;
      const lane = (seed * 7 + index * 29) % 83 / 100;
      const x = Math.floor(((time * stride + width * lane) % (width + 48)) - 24);
      const y = Math.floor(3 + (height - 18) * ((index * 7 + seed) % 19 / 19) + Math.sin(time * 1.4 + index) * 2);
      sprite(ctx, kind, rightward ? x : width - x, y, rightward, tick + index);
    });
    const particles = habitat === "reef" ? 20 : 32;
    for (let index = 0; index < particles; index += 1) {
      const drift = Math.floor(time * (habitat === "vents" ? 9 : 4) + index * 17) % height;
      const x = Math.floor(width * (((seed * 3 + index * 43) % 97) / 97) + Math.sin(time * .7 + index) * 3);
      ctx.fillStyle = habitat === "vents" ? "#d89a7777" : index % 3 === 0 ? "#deffed90" : "#acd6df56";
      ctx.fillRect(x, height - drift, index % 7 === 0 ? 2 : 1, 1);
    }
    if (habitat === "reef" || habitat === "twilight" || habitat === "vents") {
      for (const base of [.12, .87]) {
        const center = Math.floor(width * base);
        for (let branch = 0; branch < 5; branch += 1) {
          const length = 7 + branch * 2;
          for (let row = 0; row < length; row += 1) {
            const sway = Math.floor(Math.sin(time * 1.7 + branch) * row * .24);
            ctx.fillStyle = habitat === "vents" ? (row % 4 ? "#794f64" : "#c18077") : (row % 4 ? "#3b856d" : "#78b98a");
            ctx.fillRect(center + branch * 3 + sway, height - row - 1, 2, 1);
          }
        }
      }
    }
  }

  function frame(now: number) {
    if (!visible || reduced.matches) return;
    if (now - lastFrame >= 75) {
      paint(now);
      lastFrame = now;
    }
    animation = requestAnimationFrame(frame);
  }
  function updateMotion() {
    cancelAnimationFrame(animation);
    paint(performance.now());
    if (visible && !reduced.matches) animation = requestAnimationFrame(frame);
  }
  const resize = new ResizeObserver(([entry]) => {
    canvas.width = Math.max(1, Math.ceil(entry.contentRect.width / 3));
    canvas.height = Math.max(18, Math.ceil(entry.contentRect.height / 3));
    paint(performance.now());
  });
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateMotion();
  }, { rootMargin: "220px" });
  resize.observe(canvas);
  visibility.observe(canvas);
  reduced.addEventListener("change", updateMotion);
  return () => {
    cancelAnimationFrame(animation);
    resize.disconnect();
    visibility.disconnect();
    reduced.removeEventListener("change", updateMotion);
  };
}

export function OceanWildlife({ habitat, seed }: { habitat: Habitat; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas) return animateWildlife(canvas, habitat, seed);
  }, [habitat, seed]);

  return <canvas ref={ref} className="ocean-wildlife" data-habitat={habitat} aria-hidden="true" />;
}
