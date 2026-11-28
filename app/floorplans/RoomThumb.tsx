"use client";

import { doorLeafPath, roomOpenings, roomWalls, wallRunsPath } from "@/lib/floorplans/openings";
import { polygonArea, roomLocalBounds } from "@/lib/floorplans/room";
import { ROOM_TEMPLATE_UNITS_PER_METRE } from "@/lib/floorplans/roomTemplates";
import type { FloorplanCanvasObject, FloorplanRoomObject, FloorplanRoomTemplate } from "@/types";

/** A small drawing of a room template: walls, doors and fixtures. */
export function RoomThumb({ room, fixtures = [], size = 96 }: { room: FloorplanRoomObject; fixtures?: FloorplanCanvasObject[]; size?: number }) {
  const b = roomLocalBounds(room);
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const pad = Math.max(w, h) * 0.08;
  const walls = roomWalls(room);
  const stroke = Math.max(w, h) / 60;
  const floor = `M ${room.points.map((p) => `${room.x + p.x} ${room.y + p.y}`).join(" L ")} Z`;
  return (
    <svg
      className="room-thumb"
      width={size}
      height={size}
      viewBox={`${room.x + b.minX - pad} ${room.y + b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      aria-hidden="true"
    >
      <path d={floor} fill="rgba(128,146,168,0.1)" />
      {fixtures.map((f) =>
        f.type === "circle" ? (
          <circle key={f.id} cx={f.x} cy={f.y} r={f.radius} fill="#8a96a3" />
        ) : f.type === "rect" ? (
          <rect
            key={f.id}
            x={f.x}
            y={f.y}
            width={f.width}
            height={f.height}
            fill={f.keepClear ? "rgba(194,65,12,0.18)" : f.fill === "none" ? "none" : (f.fill ?? "#d9dde2")}
            stroke={f.keepClear ? "#c2410c" : "none"}
            strokeWidth={stroke / 2}
            transform={f.rotation ? `rotate(${f.rotation} ${f.x + f.width / 2} ${f.y + f.height / 2})` : undefined}
          />
        ) : null
      )}
      <path d={wallRunsPath(room, walls)} fill="none" stroke="#5b6b7d" strokeWidth={stroke} />
      {roomOpenings(room, walls).flatMap((g) =>
        g.leaves.map((leaf, i) => (
          <path key={`${g.opening.id}-${i}`} d={doorLeafPath(leaf)} fill="none" stroke={g.opening.exit ? "#1f8a4c" : "#5b6b7d"} strokeWidth={stroke / 2} />
        ))
      )}
    </svg>
  );
}

/** "18 × 12 m · 216 m²" for a template. */
export function templateSizeText(t: FloorplanRoomTemplate): string {
  const k = ROOM_TEMPLATE_UNITS_PER_METRE;
  const b = roomLocalBounds(t.room);
  const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
  return `${fmt((b.maxX - b.minX) / k)} × ${fmt((b.maxY - b.minY) / k)} m · ${(polygonArea(t.room.points) / (k * k)).toFixed(0)} m²`;
}
