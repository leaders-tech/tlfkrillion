/*
This file draws the shore and continuous reef on a coarse pixel grid.
Edit it to change the scenery or its palette. Copy the canvas setup for another decorative game scene.
*/

import { useEffect, useRef } from "react";
import "./pixel-scenery.css";

type Point = [number, number];
export type Terrain = "reef" | "vents" | "crystal" | "ruins";
type MapLayer = "shore" | "sky" | "reef" | "water";

function polygon(ctx: CanvasRenderingContext2D, color: string, points: Point[]) {
  ctx.fillStyle = color;
  const rows = points.map((point) => point[1]);
  for (let y = Math.floor(Math.min(...rows)); y < Math.max(...rows); y += 1) {
    const row = y + .5;
    const edges: number[] = [];
    points.forEach(([x, start], index) => {
      const [endX, end] = points[(index + 1) % points.length];
      if ((start <= row && row < end) || (end <= row && row < start)) {
        edges.push(x + (endX - x) * (row - start) / (end - start));
      }
    });
    edges.sort((a, b) => a - b);
    for (let index = 0; index + 1 < edges.length; index += 2) {
      const left = Math.ceil(edges[index] - .5);
      ctx.fillRect(left, y, Math.ceil(edges[index + 1] - .5) - left, 1);
    }
  }
}

function pixels(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(width), Math.floor(height));
}

const SKY_COLORS = ["#608bb8", "#709bc2", "#86acc9", "#9bbdd0", "#afccd3", "#c4d9d4"];
const WATER_COLORS = ["#32a8bd", "#258bac", "#2179a0", "#205c88", "#193c69", "#172e55", "#161f41", "#151730", "#0f1224"];
const DEEP_COLORS: Record<Exclude<Terrain, "reef">, string[]> = {
  vents: ["#14192d", "#231d32", "#14192d"],
  crystal: ["#14192d", "#172840", "#14192d"],
  ruins: ["#14192d", "#25263e", "#14192d"],
};
const DITHER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function bands(ctx: CanvasRenderingContext2D, width: number, height: number, colors: string[], stops: number[]) {
  let last = 0;
  colors.forEach((color, index) => {
    const end = Math.floor((stops[index] ?? 1) * height);
    pixels(ctx, color, 0, last, width, end - last);
    last = end;
  });
  colors.forEach((color, index) => {
    const end = Math.floor((stops[index] ?? 1) * height);
    const start = Math.floor((index === 0 ? 0 : stops[index - 1]) * height);
    const next = colors[index + 1];
    const fade = Math.min(9, end - start, height - end);
    if (next && fade > 0) {
      for (let y = end - fade; y < end + fade; y += 1) {
        const coverage = (y - end + fade) * 8 / fade;
        for (let x = 0; x < width; x += 1) {
          const useNext = DITHER[y % 4][x % 4] < coverage;
          if (useNext !== (y >= end)) pixels(ctx, useNext ? next : color, x, y, 1, 1);
        }
      }
    }
  });
}

function drawSky(ctx: CanvasRenderingContext2D, width: number, height: number) {
  bands(ctx, width, height, SKY_COLORS, [.46, .61, .75, .85, .94]);
  const x = Math.floor(width * .81);
  const y = Math.max(15, height - 74);
  polygon(ctx, "#e7dbad", [[x - 8, y - 9], [x + 7, y - 9], [x + 11, y - 5], [x + 11, y + 7], [x + 7, y + 11], [x - 8, y + 11], [x - 12, y + 7], [x - 12, y - 5]]);
  pixels(ctx, "#fff0bd", x - 6, y - 5, 11, 7);
  pixels(ctx, "#f5dfaa", x - 8, y + 5, 16, 2);
}

function drawWater(ctx: CanvasRenderingContext2D, width: number, height: number, terrain: Terrain, surface: boolean) {
  if (terrain !== "reef") {
    bands(ctx, width, height, DEEP_COLORS[terrain], [.14, .86]);
  } else if (surface) {
    bands(ctx, width, height, ["#32a8b7", "#237e99", "#1d5479", "#172d50"], [.12, .38, .69]);
  } else {
    bands(ctx, width, height, WATER_COLORS, [.025, .065, .12, .21, .34, .51, .68, .88]);
  }
  const ledges = terrain === "reef" ? [0.23, .48, .71] : [.25, .62, .81];
  ledges.forEach((position, index) => {
    const y = Math.floor(height * position);
    const step = index % 2 === 0 ? 1 : -1;
    const ridge = Math.max(15, Math.floor(height * .046));
    ctx.fillStyle = terrain === "crystal" ? "#4e73912c" : "#080e2433";
    for (let x = 0; x < width; x += 4) {
      const crest = Math.floor(Math.sin(x / 18 + index * 2) * 6 + Math.cos(x / 31) * 5 * step);
      ctx.fillRect(x, y + crest, 4, ridge);
    }
  });
  if (terrain === "reef") {
    const reach = Math.min(height, surface ? 74 : 180);
    for (let y = 0; y < reach; y += 1) {
      const n = Math.floor(y / 2);
      const opacity = (1 - y / reach) * .19;
      for (const shaft of [.12, .3, .66, .81]) {
        pixels(ctx, `rgba(170, 252, 214, ${opacity})`, width * shaft - n, y, 4 + n / 6, 1);
      }
    }
  }
}

function drawShore(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const ground = height - 1;
  const left = Math.floor(width * .27);
  const right = Math.floor(width * .24);
  ctx.save();
  ctx.translate(0, ground);
  polygon(ctx, "#4b8193", [[0, 0], [0, -13], [left * .4, -20], [left * .65, -12], [left * 1.25, 0]]);
  polygon(ctx, "#24465c", [[0, 0], [0, -8], [left * .24, -13], [left * .68, -10], [left, 0]]);
  polygon(ctx, "#5f8f73", [[0, -8], [0, -13], [left * .24, -17], [left * .65, -14], [left * .82, -6], [left * .5, -9], [left * .26, -12]]);
  for (let x = 1; x < left; x += 7) {
    const y = -3 - (x * 9 % 8);
    pixels(ctx, "#3a6371", x, y, 4, 1);
    if (x < left * .65) pixels(ctx, "#89a775", x, y - 6, 3, 1);
  }

  // The signal station and two wind-bent trees sit on the left headland.
  const house = Math.floor(left * .34);
  pixels(ctx, "#634654", house, -30, 17, 17);
  pixels(ctx, "#f1c27f", house + 1, -29, 12, 14);
  polygon(ctx, "#a55753", [[house - 3, -29], [house + 5, -38], [house + 15, -38], [house + 20, -29]]);
  pixels(ctx, "#dc8267", house + 6, -37, 8, 2);
  pixels(ctx, "#442d45", house + 3, -26, 3, 5);
  pixels(ctx, "#ffe1a0", house + 4, -25, 1, 2);
  pixels(ctx, "#795264", house + 8, -23, 4, 8);
  pixels(ctx, "#edd7a7", house + 17, -50, 2, 20);
  pixels(ctx, "#e79173", house + 15, -51, 6, 4);
  pixels(ctx, "#fff0bf", house + 16, -50, 4, 1);
  for (const tree of [4, Math.floor(left * .74)]) {
    pixels(ctx, "#594b4a", tree, -26, 2, 12);
    polygon(ctx, "#3c685f", [[tree - 6, -22], [tree - 4, -26], [tree + 1, -31], [tree + 2, -35], [tree + 6, -29], [tree + 10, -24], [tree + 6, -22]]);
    pixels(ctx, "#78a678", tree - 3, -26, 8, 2);
    pixels(ctx, "#97b983", tree, -30, 4, 2);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(width, ground);
  ctx.scale(-1, 1);
  polygon(ctx, "#3b697e", [[0, 0], [0, -29], [right * .26, -34], [right * .46, -30], [right * .61, -23], [right * .67, -13], [right, 0], [right * .68, -3], [right * .51, -7], [right * .47, -17], [right * .36, -22], [right * .19, -20], [right * .14, -15], [right * .14, 0]]);
  polygon(ctx, "#264658", [[0, 0], [0, -25], [right * .25, -28], [right * .44, -22], [right * .55, -11], [right * .77, 0], [right * .53, -4], [right * .39, -19], [right * .2, -21], [right * .1, -10], [right * .1, 0]]);
  polygon(ctx, "#7da176", [[0, -29], [right * .26, -34], [right * .46, -30], [right * .57, -25], [right * .24, -29], [0, -25]]);
  ctx.restore();
}

const ROCKS = [
  ["#174864", "#225973", "#2d7189", "#458396", "#649c9d"],
  ["#142f53", "#1d405e", "#2b526c", "#3c627b", "#54798b"],
  ["#111f3a", "#172941", "#263650", "#3b4a63", "#525b78"],
  ["#100f28", "#1b1931", "#26243e", "#362e4d", "#505067"],
];

function reefPalette(fraction: number) {
  const position = Math.min(3, fraction * 3);
  const first = Math.floor(position);
  const next = Math.min(3, first + 1);
  const blend = position - first;
  return ROCKS[first].map((color, index) => {
    const start = Number.parseInt(color.slice(1), 16);
    const end = Number.parseInt(ROCKS[next][index].slice(1), 16);
    const channels = [16, 8, 0].map((shift) => {
      const from = (start >> shift) & 255;
      const to = (end >> shift) & 255;
      return Math.round(from + (to - from) * blend);
    });
    return `rgb(${channels.join(" ")})`;
  });
}

function cliffEdge(width: number, y: number, side: number) {
  const seed = y + side * 68;
  const slope = Math.sin(seed / 24) * .043 + Math.cos(seed / 12) * .031;
  const terrace = Math.floor(seed / 9) * 17 % 19;
  return Math.floor((.18 + slope) * width + (terrace - 9) * .42);
}

function drawCoral(ctx: CanvasRenderingContext2D, x: number, y: number, variety: number) {
  if (variety === 0) {
    // Sea fan with a shaded back and bright growing tips.
    polygon(ctx, "#815b83", [[x, y], [x - 9, y - 7], [x - 11, y - 14], [x - 5, y - 12], [x - 2, y - 16], [x + 2, y - 19], [x + 4, y - 13], [x + 11, y - 15], [x + 10, y - 8], [x + 3, y]]);
    pixels(ctx, "#d09dbe", x, y - 14, 2, 13);
    pixels(ctx, "#d09dbe", x - 5, y - 11, 6, 2);
    pixels(ctx, "#d09dbe", x + 2, y - 9, 5, 2);
    pixels(ctx, "#f4c1bd", x - 8, y - 13, 2, 2);
    pixels(ctx, "#f4c1bd", x + 7, y - 12, 2, 2);
  } else if (variety === 1) {
    for (let stem = 0; stem < 3; stem += 1) {
      const stemX = x + stem * 4;
      const length = 11 + stem * 4;
      pixels(ctx, "#326d66", stemX, y - length, 2, length);
      for (let leaf = 2; leaf < length - 1; leaf += 4) {
        const leafX = stemX - (leaf % 3 === 0 ? 3 : 0);
        pixels(ctx, "#6aac88", leafX, y - leaf, 4, 2);
      }
      pixels(ctx, "#a8c796", stemX, y - length, 2, 3);
    }
  } else {
    for (let tube = 0; tube < 4; tube += 1) {
      const tubeX = x + tube * 4 - 6;
      const length = 4 + tube * 7 % 8;
      pixels(ctx, "#946475", tubeX, y - length, 4, length);
      pixels(ctx, "#dfa082", tubeX, y - length, 4, 2);
      pixels(ctx, "#694e6a", tubeX + 1, y - length, 2, 1);
    }
  }
}

function drawLandmark(ctx: CanvasRenderingContext2D, x: number, y: number, terrain: Exclude<Terrain, "reef">, detail: number) {
  if (terrain === "vents") {
    const chimneys = detail % 3 === 0 ? [[-6, 16], [5, 23]] : [[-9, 12], [0, 20 + detail % 8], [9, 17]];
    for (const [dx, height] of chimneys) {
      const base = x + dx;
      polygon(ctx, "#343044", [[base - 7, y], [base - 3, y - height], [base + 5, y - height - 1], [base + 6, y], [base + 9, y]]);
      pixels(ctx, "#75485a", base - 1, y - height, 5, height - 2);
      pixels(ctx, "#d2836d", base - 2, y - height, 7, 2);
      pixels(ctx, "#442737", base, y - height, 4, 1);
    }
  } else if (terrain === "crystal") {
    const cluster = detail % 3 === 0 ? [[-6, 22], [5, 16]] : [[-7, 16], [0, 22 + detail % 9], [8, 19]];
    for (const [dx, height] of cluster) {
      const base = x + dx;
      polygon(ctx, "#485c84", [[base - 7, y], [base - 5, y - height + 7], [base, y - height], [base + 7, y - height + 9], [base + 5, y]]);
      polygon(ctx, "#558b9e", [[base, y - height], [base + 5, y - height + 10], [base + 1, y - 2], [base - 2, y - height + 10]]);
      pixels(ctx, "#a9ddd5", base, y - height + 3, 2, 6);
    }
  } else {
    pixels(ctx, "#232b46", x - 13, y - 20, 25, 20);
    pixels(ctx, "#536078", x - 13, y - 21, 25, 2);
    pixels(ctx, "#191f32", x - 7, y - 14, 12, 15);
    for (const dx of [-12, 7]) {
      pixels(ctx, "#4d4d68", x + dx, y - 18, 4, 16);
      pixels(ctx, "#76a8a1", x + dx + 1, y - 16, 2, 3);
    }
    pixels(ctx, "#666580", x - 14, y - 2, 29, 3);
  }
}

function drawReef(ctx: CanvasRenderingContext2D, width: number, height: number, terrain: Terrain = "reef", surface = false, seed = 0) {
  const depthSpan = Math.max(height, 860);
  // Draw both cliff walls down the full water column so there are no repeat seams.
  for (const side of [0, 1]) {
    ctx.save();
    if (side === 1) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    for (let y = 0; y < height; y += 2) {
      const palette = reefPalette(terrain === "reef" ? y / depthSpan : .79 + y / height * .19);
      const rock = y + side * 68 + seed;
      const shelf = cliffEdge(width, y + seed, side);
      pixels(ctx, palette[1], 0, y, shelf + width * .06, 3);
      pixels(ctx, palette[0], 0, y, shelf, 2);
      pixels(ctx, palette[2], shelf - 5, y, 7, 2);
      if (y % 6 === 0) {
        const stratum = Math.max(1, shelf - (rock * 13 % 17) - 4);
        pixels(ctx, palette[3], stratum, y, 5 + rock % 7, 2);
        pixels(ctx, palette[2], rock * 23 % Math.max(4, shelf - 13), y + 1, 8, 1);
      }
    }
    for (let y = 22 + side * 13; y < height - 12; y += 30 + y % 17) {
      const depth = terrain === "reef" ? y / depthSpan : .79 + y / height * .19;
      const palette = reefPalette(depth);
      const edge = cliffEdge(width, y + seed, side);
      const inside = Math.max(0, edge - width * .11);
      const detail = (y * 13 + side * 37 + seed) % 23;
      const ledge = edge + width * (.028 + detail / 590);
      const ledgeTip = detail % 5 - 2;
      // Offset the strokes and facets so the terraces don't repeat at each depth.
      polygon(ctx, palette[0], [[inside - 5, y - 3], [ledge, y - 3], [ledge + 5 + ledgeTip, y + 2], [ledge - 7, y + 15 + ledgeTip], [inside, y + 18]]);
      polygon(ctx, palette[2], [[inside - 6, y - 1], [inside + 8, y - 7], [ledge - 8, y - 7 - ledgeTip], [ledge + 5 + ledgeTip, y], [ledge - 6, y + 4], [inside, y + 6]]);
      polygon(ctx, palette[1], [[inside, y + 7], [ledge - 8, y + 4], [ledge - 15, y + 11], [inside + 3, y + 16]]);
      pixels(ctx, palette[3], ledge - 13, y - 6, 14, 2);
      pixels(ctx, palette[4], ledge - 11, y - 7, 7, 1);
      pixels(ctx, palette[3], inside + 4, y, Math.max(3, edge - inside - 5), 1);
      if (terrain !== "reef") {
        if (y % 4 !== side) drawLandmark(ctx, ledge - 9, y - 6, terrain, detail);
      } else if (!surface && depth > .46) {
        const formation = depth > .81 ? "vents" : depth > .64 ? "ruins" : "crystal";
        if (y % 3 === side) drawLandmark(ctx, ledge - 9, y - 6, formation, detail);
        else pixels(ctx, "#878fc1", ledge, y - 13, 2, 2);
      } else {
        drawCoral(ctx, ledge - 8, y - 7, (y + side) % 3);
      }
    }
    ctx.restore();
  }
}

function PixelCanvas({ kind, terrain = "reef", surface = false, seed = 0 }: {
  kind: MapLayer; terrain?: Terrain; surface?: boolean; seed?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drawAtSize = (width: number, height: number) => {
      if (width === 0 || height === 0) return;
      canvas.width = Math.ceil(width / 3);
      canvas.height = Math.ceil(height / 3);
      // Composite at map resolution first, then snap alpha before nearest-neighbor presentation.
      const buffer = document.createElement("canvas");
      buffer.width = canvas.width;
      buffer.height = canvas.height;
      const ctx = buffer.getContext("2d", { willReadFrequently: true });
      const display = canvas.getContext("2d");
      if (!ctx || !display) return;
      const { width: w, height: h } = buffer;
      if (kind === "shore") drawShore(ctx, w, h);
      if (kind === "sky") drawSky(ctx, w, h);
      if (kind === "reef") drawReef(ctx, w, h, terrain, surface, seed);
      if (kind === "water") drawWater(ctx, w, h, terrain, surface);
      const frame = ctx.getImageData(0, 0, w, h);
      for (let index = 3; index < frame.data.length; index += 4) {
        frame.data[index] = frame.data[index] >= 128 ? 255 : 0;
      }
      display.putImageData(frame, 0, 0);
    };
    if (typeof ResizeObserver === "undefined") {
      const redraw = () => drawAtSize(canvas.clientWidth, canvas.clientHeight);
      redraw();
      window.addEventListener("resize", redraw);
      return () => window.removeEventListener("resize", redraw);
    }
    const observer = new ResizeObserver(([entry]) => {
      drawAtSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [kind, terrain, surface, seed]);

  return <canvas ref={canvasRef} className={kind === "shore" ? "pixel-shoreline" : `pixel-${kind}`} aria-hidden="true" />;
}

export function SkyScenery() {
  return (
    <>
      <PixelCanvas kind="sky" />
      <div className="sky-clouds">
        <span className="pixel-cloud cloud-one" />
        <span className="pixel-cloud cloud-two" />
        <span className="pixel-cloud cloud-three" />
      </div>
      <div className="sky-wind" />
      <PixelCanvas kind="shore" />
      <div className="sky-birds"><i /><i /><i /></div>
      <div className="survey-boat"><i /><b /></div>
    </>
  );
}

export function ReefScenery({ terrain = "reef", surface = false, seed = 0 }: { terrain?: Terrain; surface?: boolean; seed?: number }) {
  return (
    <>
      <PixelCanvas kind="water" terrain={terrain} surface={surface} />
      <PixelCanvas kind="reef" terrain={terrain} surface={surface} seed={seed} />
    </>
  );
}
