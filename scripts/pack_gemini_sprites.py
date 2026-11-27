#!/usr/bin/env python3
"""
Turnkey Connected-Component processor for Gemini-generated capbaseball pixel sprite sheets.
- Flood-fills magenta (#FF00FF) background + 2-pass JPEG halo despill.
- Extracts each character frame via Connected Components (never chops wide diving shoes or bat tips!).
- Groups nearby small fragments (detached swoosh arcs, cap/hand pixels) into their nearest main sprite.
- Aligns feet baseline to exact game cell sizes (136x113 for fielders/pitcher_field, 148x114 for batters).
- Auto-generates Black away-jersey variants while preserving the bright yellow bat on batters.
"""
import argparse
import collections
import colorsys
import json
import os
from PIL import Image

SPRITES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "sprites"))


def is_magenta_bg(r: int, g: int, b: int, strict: bool = False) -> bool:
    if strict:
        return r > 135 and b > 135 and g < 85 and (min(r, b) - g) > 65 and abs(r - b) < 55
    return r > 120 and b > 120 and g < 115 and (min(r, b) - g) > 42 and abs(r - b) < 80


def remove_bg_floodfill(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    if all(c[3] < 20 for c in corners):
        return im

    visited = bytearray(w * h)
    q = collections.deque()

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 20:
                visited[y * w + x] = 1
                continue
            on_border = x == 0 or y == 0 or x == w - 1 or y == h - 1
            if (on_border and is_magenta_bg(r, g, b, strict=False)) or is_magenta_bg(r, g, b, strict=True):
                visited[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx]:
                r, g, b, a = px[nx, ny]
                if is_magenta_bg(r, g, b, strict=False):
                    visited[ny * w + nx] = 1
                    q.append((nx, ny))

    # 2-pass edge despill
    for _ in range(2):
        to_clear = []
        to_despill = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                adj_trans = False
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                        adj_trans = True
                        break
                if adj_trans and min(r, b) > g + 18:
                    if r > 85 and b > 85 and g < 85:
                        to_clear.append((x, y))
                    else:
                        ng = min(255, int((r + b) * 0.45))
                        to_despill.append((x, y, (min(r, ng + 8), g, min(b, ng + 8), a)))
        for x, y in to_clear:
            px[x, y] = (0, 0, 0, 0)
        for x, y, col in to_despill:
            px[x, y] = col

    return im


def extract_sprites_cc(
    im: Image.Image,
    expected_count: int,
    rows: int,
    crop_bottom_frac: float = 0.0,
    row_split_frac: float = 0.5,
    hard_row_split: bool = False,
    max_extra_dist: float = 36.0,
) -> list[Image.Image]:
    """Extract each character cleanly via connected components (isolated per row if needed)."""
    w, h = im.size
    work = im.copy()
    px = work.load()

    if hard_row_split and rows == 2:
        # Cleanly split the 2 rows into independent strips before connected-component extraction
        sy = int(round(h * row_split_frac))
        top_band = work.crop((0, 0, w, sy))
        bot_band = work.crop((0, sy, w, h))
        per_row = expected_count // 2
        return (
            extract_sprites_cc(top_band, per_row, 1, crop_bottom_frac, 0.5, False, max_extra_dist)
            + extract_sprites_cc(bot_band, expected_count - per_row, 1, crop_bottom_frac, 0.5, False, max_extra_dist)
        )

    # Mask out caption bands below each row if requested
    if crop_bottom_frac > 0:
        row_bounds = (
            [(0, int(round(h * row_split_frac))), (int(round(h * row_split_frac)), h)]
            if rows == 2
            else [(int(round(h * r / rows)), int(round(h * (r + 1) / rows))) for r in range(rows)]
        )
        for ry0, ry1 in row_bounds:
            cut_y = ry1 - int(round((ry1 - ry0) * crop_bottom_frac))
            for y in range(cut_y, ry1):
                for x in range(w):
                    px[x, y] = (0, 0, 0, 0)

    # Find connected components (8-connected via 4-connected + small bridge tolerance)
    visited = bytearray(w * h)
    comps = []
    for y in range(h):
        for x in range(w):
            if visited[y * w + x] or px[x, y][3] < 20:
                continue
            pts = []
            q = collections.deque([(x, y)])
            visited[y * w + x] = 1
            minx = maxx = x
            miny = maxy = y
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                if cx < minx: minx = cx
                if cx > maxx: maxx = cx
                if cy < miny: miny = cy
                if cy > maxy: maxy = cy
                for nx, ny in ((cx-1, cy), (cx+1, cy), (cx, cy-1), (cx, cy+1)):
                    if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx] and px[nx, ny][3] >= 20:
                        visited[ny * w + nx] = 1
                        q.append((nx, ny))
            comps.append({
                "pts": pts,
                "area": len(pts),
                "bbox": (minx, miny, maxx + 1, maxy + 1),
                "cx": (minx + maxx) * 0.5,
                "cy": (miny + maxy) * 0.5,
            })

    # If two vertical sprites accidentally touched by 1-2px (e.g. Row 2 fingertips touching Row 1 shoe),
    # split any overly tall component (> 58% of image height) cleanly at its narrowest horizontal waist!
    split_comps = []
    for c in comps:
        minx, miny, maxx, maxy = c["bbox"]
        if rows == 2 and (maxy - miny) > h * 0.56 and c["area"] > 800:
            # Find narrowest row count between 35% and 65% of image height
            row_counts = collections.Counter(y for _, y in c["pts"])
            best_y = min(range(int(h * 0.38), int(h * 0.62)), key=lambda yy: row_counts.get(yy, 0))
            top_pts = [(x, y) for x, y in c["pts"] if y < best_y]
            bot_pts = [(x, y) for x, y in c["pts"] if y > best_y]
            for sub in (top_pts, bot_pts):
                if len(sub) > 100:
                    sxs = [p[0] for p in sub]
                    sys_ = [p[1] for p in sub]
                    split_comps.append({
                        "pts": sub,
                        "area": len(sub),
                        "bbox": (min(sxs), min(sys_), max(sxs) + 1, max(sys_) + 1),
                        "cx": (min(sxs) + max(sxs)) * 0.5,
                        "cy": (min(sys_) + max(sys_)) * 0.5,
                    })
        else:
            split_comps.append(c)

    # Sort descending by area and pick top `expected_count` main character bodies
    split_comps.sort(key=lambda c: c["area"], reverse=True)
    mains = split_comps[:expected_count]
    extras = split_comps[expected_count:]

    # Attach meaningful nearby extras (e.g. swing motion swoosh arcs) to their closest main sprite (if within 42px of bbox)
    for ex in extras:
        if ex["area"] < 12:
            continue
        ex_x0, ex_y0, ex_x1, ex_y1 = ex["bbox"]
        best_m = None
        best_dist = 999999.0
        for m in mains:
            mx0, my0, mx1, my1 = m["bbox"]
            dx = max(0, max(mx0 - ex_x1, ex_x0 - mx1))
            dy = max(0, max(my0 - ex_y1, ex_y0 - my1))
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < best_dist:
                best_dist = dist
                best_m = m
        if best_m is not None and best_dist <= max_extra_dist:
            best_m["pts"].extend(ex["pts"])
            mx0, my0, mx1, my1 = best_m["bbox"]
            best_m["bbox"] = (min(mx0, ex_x0), min(my0, ex_y0), max(mx1, ex_x1), max(my1, ex_y1))

    # Order mains into rows (top row first, then left-to-right within each row)
    split_y = h * row_split_frac
    if rows == 2:
        row0 = sorted([m for m in mains if m["cy"] < split_y], key=lambda m: m["cx"])
        row1 = sorted([m for m in mains if m["cy"] >= split_y], key=lambda m: m["cx"])
        ordered = row0 + row1
    else:
        ordered = sorted(mains, key=lambda m: m["cx"])

    # Render each character onto its own clean isolated RGBA image!
    sprites = []
    for m in ordered:
        x0, y0, x1, y1 = m["bbox"]
        sp = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        sp_px = sp.load()
        for x, y in m["pts"]:
            sp_px[x - x0, y - y0] = px[x, y]
        sprites.append(sp)
    return sprites


def _is_yellow_seed(r: int, g: int, b: int) -> bool:
    hh, ss, vv = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    deg = hh * 360.0
    # Strict vivid yellow jersey seed (deg >= 42 completely excludes all warm tan/orange skin tones!)
    return 42.0 <= deg <= 72.0 and ss >= 0.48 and vv >= 0.35


def _is_yellow_shadow_or_fringe(r: int, g: int, b: int) -> bool:
    """Catches gold-ochre jersey shadows & fringes connected to vivid yellow without ever touching skin or white numbers."""
    hh, ss, vv = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    deg = hh * 360.0
    if vv > 0.78 and ss < 0.34:
        return False
    return 36.0 <= deg <= 75.0 and ss >= 0.34 and vv >= 0.20


def _grow_and_recolor(px, w: int, h: int, seed_pts: set[tuple[int, int]], x_bounds: tuple[int, int], max_dist: int = 5) -> set[tuple[int, int]]:
    """Bounded 2px hysteresis grow from vivid yellow seeds into adjacent gold-ochre jersey shadows/fringes only."""
    x0, x1 = x_bounds
    recolored = set(seed_pts)
    dq = collections.deque((pt[0], pt[1], 0) for pt in seed_pts)
    while dq:
        cx, cy, dist = dq.popleft()
        if dist >= max_dist:
            continue
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = cx + dx, cy + dy
                if x0 <= nx < x1 and 0 <= ny < h and (nx, ny) not in recolored:
                    r, g, b, a = px[nx, ny]
                    if a >= 20 and _is_yellow_shadow_or_fringe(r, g, b):
                        recolored.add((nx, ny))
                        dq.append((nx, ny, dist + 1))

    for (x, y) in recolored:
        r, g, b, a = px[x, y]
        _, _, vv = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        nv = 0.11 + max(0.0, vv - 0.18) * 0.25
        nr, ng, nb = colorsys.hsv_to_rgb(218.0 / 360.0, 0.28, max(0.09, min(0.34, nv)))
        px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return recolored


def yellow_to_black_jersey(im: Image.Image, preserve_bat: bool = False, invert_dark_num: bool = False, cell_w: int = 136) -> Image.Image:
    out = im.copy().convert("RGBA")
    px = out.load()
    w, h = out.size

    if not preserve_bat:
        seeds = set()
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a >= 20 and _is_yellow_seed(r, g, b):
                    seeds.add((x, y))
        _grow_and_recolor(px, w, h, seeds, (0, w))
        return out

    # For batters: recolor jersey torso + shorts yellow stripes via hysteresis grow, preserving the yellow bat 100%!
    n_cells = w // cell_w
    for ci in range(n_cells):
        x0 = ci * cell_w
        x1 = x0 + cell_w
        c_min_y, c_max_y = h, 0
        for y in range(h):
            for x in range(x0, x1):
                if px[x, y][3] >= 20:
                    if y < c_min_y: c_min_y = y
                    if y > c_max_y: c_max_y = y
        if c_min_y >= c_max_y:
            continue

        is_yel = set()
        for y in range(h):
            for x in range(x0, x1):
                r, g, b, a = px[x, y]
                if a >= 20 and _is_yellow_seed(r, g, b):
                    is_yel.add((x, y))

        seen = set()
        comps = []
        for pt in is_yel:
            if pt in seen:
                continue
            comp = []
            dq = collections.deque([pt])
            seen.add(pt)
            while dq:
                cx, cy = dq.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx-1, cy), (cx+1, cy), (cx, cy-1), (cx, cy+1)):
                    if (nx, ny) in is_yel and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        dq.append((nx, ny))
            xs = [p[0] for p in comp]
            ys = [p[1] for p in comp]
            bw = max(xs) - min(xs) + 1
            bh = max(ys) - min(ys) + 1
            avg_y_frac = (sum(ys) / len(ys) - c_min_y) / max(1, (c_max_y - c_min_y))
            aspect = max(bw / max(1, bh), bh / max(1, bw))
            fill_ratio = len(comp) / max(1.0, float(bw * bh))
            comps.append((len(comp), aspect, avg_y_frac, min(xs), max(xs), min(ys), max(ys), comp, fill_ratio))

        # 1. Primary torso jersey blob (largest solid compact yellow blob in mid-torso y_frac 0.20..0.74;
        #    fill_ratio >= 0.34 cleanly excludes hollow crescent swing arcs whose fill_ratio is ~0.15..0.26!)
        torso_candidates = [c for c in comps if c[0] >= 40 and c[1] <= 3.1 and 0.20 <= c[2] <= 0.74 and c[8] >= 0.34]
        if not torso_candidates:
            torso_candidates = [c for c in comps if c[0] >= 40 and c[1] <= 3.1 and 0.20 <= c[2] <= 0.74]
        torso_candidates.sort(key=lambda c: (c[0] * c[8]) / max(1.0, c[1] * 0.65), reverse=True)
        seed_pts = set()
        torso_x0, torso_x1 = x0, x1
        if torso_candidates:
            primary = torso_candidates[0]
            torso_x0, torso_x1 = primary[3] - 8, primary[4] + 8
            py0, py1 = primary[5] - 6, primary[6] + 6
            for p in primary[7]:
                seed_pts.add(p)
            for area, asp, yf, cx0, cx1, cy0, cy1, comp, fill in comps:
                if comp is primary[7]:
                    continue
                # Split jersey halves (e.g. white sleeve/number dividing upper & lower back torso!)
                if area >= 22 and fill >= 0.35 and asp <= 3.1 and 0.22 <= yf <= 0.72 and cx1 >= torso_x0 - 4 and cx0 <= torso_x1 + 4:
                    for p in comp:
                        seed_pts.add(p)
                    continue
                # Interior/split jersey fragments inside torso bounds (including chest split above crossing arm!)
                if cx0 >= torso_x0 - 4 and cx1 <= torso_x1 + 4 and (
                    (cy0 >= py0 - 16 and cy1 <= py1 + 6 and asp <= 2.4 and 0.22 <= yf <= 0.72)
                ):
                    for p in comp:
                        seed_pts.add(p)
                # Yellow side stripes on black shorts (strictly inside shorts/hip width, small area, never a hanging bat!)
                elif 0.58 <= yf <= 0.80 and cx0 >= torso_x0 - 2 and cx1 <= torso_x1 + 2 and area <= 85 and asp <= 2.8:
                    for p in comp:
                        seed_pts.add(p)

        recolored = _grow_and_recolor(px, w, h, seed_pts, (x0, x1))

        if invert_dark_num and recolored:
            # Restrict number brightening to torso vertical band
            torso_only = [p for p in recolored if (p[1] - c_min_y) / max(1, (c_max_y - c_min_y)) <= 0.62]
            if torso_only:
                txs = [p[0] for p in torso_only]
                tys = [p[1] for p in torso_only]
                t_min_x, t_max_x = min(txs) + 2, max(txs) - 2
                t_min_y, t_max_y = min(tys) + 2, max(tys) - 2
                for y in range(t_min_y, t_max_y + 1):
                    for x in range(t_min_x, t_max_x + 1):
                        if (x, y) in recolored:
                            continue
                        r, g, b, a = px[x, y]
                        if a >= 200 and r < 75 and g < 75 and b < 75:
                            has_l = any((x - d, y) in recolored for d in range(1, 7))
                            has_r = any((x + d, y) in recolored for d in range(1, 7))
                            has_u = any((x, y - d) in recolored for d in range(1, 7))
                            has_d = any((x, y + d) in recolored for d in range(1, 7))
                            if has_l and has_r and has_u and has_d:
                                px[x, y] = (232, 236, 242, a)

    return out


def neutralize_outline_magenta(im: Image.Image) -> Image.Image:
    """Neutralize any purplish/magenta tint on dark outer-edge pixels adjacent to transparency."""
    out = im.copy().convert("RGBA")
    px = out.load()
    w, h = out.size
    for _ in range(2):
        updates = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a < 20:
                    continue
                adj_trans = False
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] < 20:
                            adj_trans = True
                            break
                    if adj_trans:
                        break
                if adj_trans and min(r, b) > g + 6:
                    # Pure neutral dark charcoal outline if dark, otherwise remove magenta excess
                    if g < 95:
                        v = min(r, g, b)
                        updates.append((x, y, (v, v, v, a)))
                    else:
                        updates.append((x, y, (min(r, g + 4), g, min(b, g + 4), a)))
        for x, y, col in updates:
            px[x, y] = col
    return out


def pack_sprites_to_strip(
    sprites: list[Image.Image],
    cell_w: int,
    cell_h: int,
    baseline_y: int,
    per_sprite_normalize_indices: set[int] | None = None,
    fixed_scale: float | None = None,
    anchor_by_feet: bool = False,
) -> Image.Image:
    heights = sorted([sp.size[1] for i, sp in enumerate(sprites) if not per_sprite_normalize_indices or i not in per_sprite_normalize_indices])
    ref_h = heights[int(len(heights) * 0.72)] if heights else 100
    target_h = int(baseline_y * 0.87)
    base_scale = fixed_scale if fixed_scale is not None else (target_h / max(1, ref_h))

    strip = Image.new("RGBA", (cell_w * len(sprites), cell_h), (0, 0, 0, 0))
    for i, sp in enumerate(sprites):
        cw, ch = sp.size
        max_h = baseline_y - 2
        max_w = cell_w - 4
        if per_sprite_normalize_indices and i in per_sprite_normalize_indices:
            # Match standing height of swapped sprite cleanly!
            scale = min(target_h / max(1, ch), max_w / cw, max_h / ch)
        else:
            scale = min(base_scale, max_w / cw, max_h / ch)
        nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
        # Use BOX (area-averaging, strictly non-negative kernel) instead of LANCZOS to prevent RGB ringing specks!
        resized = sp.resize((nw, nh), Image.Resampling.BOX)
        r_px = resized.load()
        foot_xs: list[int] = []
        foot_y0 = int(nh * 0.65)
        for yy in range(nh):
            for xx in range(nw):
                rr, gg, bb_c, aa = r_px[xx, yy]
                if aa < 110:
                    r_px[xx, yy] = (0, 0, 0, 0)
                else:
                    r_px[xx, yy] = (rr, gg, bb_c, 255)
                    if anchor_by_feet and yy >= foot_y0 and not _is_yellow_seed(rr, gg, bb_c):
                        foot_xs.append(xx)
        if anchor_by_feet and foot_xs:
            foot_cx = int(round(sum(foot_xs) / len(foot_xs)))
            local_x = (cell_w // 2) - foot_cx
            local_x = max(1, min(cell_w - nw - 1, local_x))
            dx = i * cell_w + local_x
        else:
            dx = i * cell_w + (cell_w - nw) // 2
        dy = baseline_y - nh
        strip.paste(resized, (dx, dy), resized)
    return neutralize_outline_magenta(strip)


def build_atlas(frame_names, anims, cell_w, cell_h, baseline_y):
    frames = {}
    for i, name in enumerate(frame_names):
        frames[name] = {
            "frame": {"x": i * cell_w, "y": 0, "w": cell_w, "h": cell_h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": cell_w, "h": cell_h},
            "sourceSize": {"w": cell_w, "h": cell_h},
            "duration": 120,
        }
    return {"frames": frames, "animations": anims, "baseline_y": baseline_y}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True, choices=["fielder99", "pitcher_field18", "batter18", "batter99"])
    ap.add_argument("--input", required=True)
    ap.add_argument("--rows", type=int, default=2)
    ap.add_argument("--crop-bottom-frac", type=float, default=0.0)
    ap.add_argument("--row-split-frac", type=float, default=0.5)
    ap.add_argument("--hard-row-split", action="store_true")
    ap.add_argument("--swap-idx", type=int, default=-1)
    ap.add_argument("--swap-from", default="")
    ap.add_argument("--out-dir", default=SPRITES_DIR)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    clean_im = remove_bg_floodfill(Image.open(args.input))

    if args.mode == "fielder99":
        names = [
            "idle_0", "idle_1",
            "run_0", "run_1", "run_2", "run_3",
            "catch_fly_0", "catch_fly_1",
            "catch_ground_0", "catch_ground_1",
            "catch_wp_0", "catch_wp_1",
        ]
        anims = {
            "idle": {"frames": ["idle_0", "idle_1"], "loop": True, "duration": 480},
            "run": {"frames": ["run_0", "run_1", "run_2", "run_3"], "loop": True, "duration": 360},
            "catch_fly": {"frames": ["catch_fly_0", "catch_fly_1"], "loop": False, "duration": 320},
            "catch_ground": {"frames": ["catch_ground_0", "catch_ground_1"], "loop": False, "duration": 320},
            "catch_wp": {"frames": ["catch_wp_0", "catch_wp_1"], "loop": False, "duration": 420},
            "dive": {"frames": ["catch_ground_0", "catch_ground_1"], "loop": False, "duration": 320},
        }
        sprites = extract_sprites_cc(
            clean_im, 12, args.rows, args.crop_bottom_frac, args.row_split_frac, args.hard_row_split
        )
        assert len(sprites) == 12, f"Expected 12 sprites, got {len(sprites)}"
        yellow = pack_sprites_to_strip(sprites, 136, 113, 112)
        black = yellow_to_black_jersey(yellow, preserve_bat=False)
        yellow.save(os.path.join(args.out_dir, "fielder_yellow.png"))
        black.save(os.path.join(args.out_dir, "fielder_black.png"))
        with open(os.path.join(args.out_dir, "fielder.atlas.json"), "w", encoding="utf-8") as f:
            json.dump(build_atlas(names, anims, 136, 113, 112), f, indent=2)
        print("Packed fielder_yellow.png, fielder_black.png, fielder.atlas.json")

    elif args.mode == "pitcher_field18":
        names = [
            "idle_0", "idle_1",
            "run_0", "run_1", "run_2", "run_3",
            "catch_fly_0", "catch_fly_1",
            "catch_ground_0", "catch_ground_1",
        ]
        anims = {
            "idle": {"frames": ["idle_0", "idle_1"], "loop": True, "duration": 480},
            "run": {"frames": ["run_0", "run_1", "run_2", "run_3"], "loop": True, "duration": 360},
            "catch_fly": {"frames": ["catch_fly_0", "catch_fly_1"], "loop": False, "duration": 320},
            "catch_ground": {"frames": ["catch_ground_0", "catch_ground_1"], "loop": False, "duration": 320},
            "dive": {"frames": ["catch_ground_0", "catch_ground_1"], "loop": False, "duration": 320},
        }
        sprites = extract_sprites_cc(clean_im, 10, args.rows, args.crop_bottom_frac, args.row_split_frac)
        assert len(sprites) == 10, f"Expected 10 sprites, got {len(sprites)}"
        yellow = pack_sprites_to_strip(sprites, 136, 113, 112)
        black = yellow_to_black_jersey(yellow, preserve_bat=False)
        yellow.save(os.path.join(args.out_dir, "pitcher_field_yellow.png"))
        black.save(os.path.join(args.out_dir, "pitcher_field_black.png"))
        with open(os.path.join(args.out_dir, "pitcher_field.atlas.json"), "w", encoding="utf-8") as f:
            json.dump(build_atlas(names, anims, 136, 113, 112), f, indent=2)
        print("Packed pitcher_field_yellow.png, pitcher_field_black.png, pitcher_field.atlas.json")

    elif args.mode == "batter18":
        sprites = extract_sprites_cc(clean_im, 10, args.rows, args.crop_bottom_frac, args.row_split_frac)
        assert len(sprites) == 10, f"Expected 10 sprites, got {len(sprites)}"
        yellow = pack_sprites_to_strip(sprites, 148, 114, 112)
        black = yellow_to_black_jersey(yellow, preserve_bat=True, invert_dark_num=True, cell_w=148)
        yellow.save(os.path.join(args.out_dir, "batter_18_yellow_strip.png"))
        black.save(os.path.join(args.out_dir, "batter_18_black_strip.png"))
        meta = {
            "frames": 10, "w": 148, "h": 114, "baseline_y": 112, "anchor_x": 74,
            "natural_handedness": "right",
            "anims": {
                "ready": [0, 1, 2, 1], "load": [3],
                "swing_early": [4], "swing_contact": [4, 5], "follow_through": [6, 7, 8, 9],
            },
        }
        with open(os.path.join(args.out_dir, "batter_18.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        print("Packed batter_18_yellow_strip.png, batter_18_black_strip.png, batter_18.json")

    elif args.mode == "batter99":
        sprites = extract_sprites_cc(clean_im, 10, args.rows, args.crop_bottom_frac, args.row_split_frac)
        assert len(sprites) == 10, f"Expected 10 sprites, got {len(sprites)}"
        norm_idxs = set()
        if args.swap_idx >= 0 and args.swap_from:
            swap_im = remove_bg_floodfill(Image.open(args.swap_from))
            swap_sprites = extract_sprites_cc(swap_im, 10, args.rows, 0.0, 0.5)
            sprites[args.swap_idx] = swap_sprites[args.swap_idx]
            norm_idxs.add(args.swap_idx)
        yellow = pack_sprites_to_strip(sprites, 148, 114, 112, per_sprite_normalize_indices=norm_idxs)
        black = yellow_to_black_jersey(yellow, preserve_bat=True, invert_dark_num=False, cell_w=148)
        yellow.save(os.path.join(args.out_dir, "batter_real_yellow_strip.png"))
        black.save(os.path.join(args.out_dir, "batter_real_black_strip.png"))
        meta = {
            "frames": 10, "w": 148, "h": 114, "baseline_y": 112, "anchor_x": 74,
            "natural_handedness": "left",
            "anims": {
                "ready": [0, 1, 2, 1], "load": [3],
                "swing_early": [4], "swing_contact": [4, 5], "follow_through": [6, 7, 8, 9],
            },
        }
        with open(os.path.join(args.out_dir, "batter_real.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        print("Packed batter_real_yellow_strip.png, batter_real_black_strip.png, batter_real.json")


if __name__ == "__main__":
    main()
