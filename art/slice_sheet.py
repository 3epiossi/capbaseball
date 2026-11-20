# 將 Gemini 產生的姿勢／角色網格圖切成透明背景遊戲影格（PNG、橫向序列圖 strip、預覽 GIF 與 JSON 中繼資料），預設啟用腳底對齊鎖定避免鏡頭晃動。
# 用法：uv run --with pillow --with numpy --with opencv-python python capbaseball/art/slice_sheet.py SHEET... --rows R --cols C --name NAME [--height H] [--fps F] [--out DIR] [--no-lock]
# 自我測試：uv run --with pillow --with numpy --with opencv-python python capbaseball/art/slice_sheet.py --selftest
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BG_PREVIEW_RGB = (58, 52, 70)  # #3a3446


def compute_fg_mask(rgb: np.ndarray, tol: int = 20, min_area: int = 9) -> np.ndarray:
    """Key out the flat background (median of 4 corner patches) and drop isolated speckles."""
    h, w, _ = rgb.shape
    p = max(2, min(16, h // 12, w // 12))
    corners = np.concatenate(
        [
            rgb[:p, :p].reshape(-1, 3),
            rgb[:p, -p:].reshape(-1, 3),
            rgb[-p:, :p].reshape(-1, 3),
            rgb[-p:, -p:].reshape(-1, 3),
        ],
        axis=0,
    )
    bg = np.median(corners, axis=0)
    dist = np.abs(rgb.astype(np.float32) - bg.astype(np.float32)).max(axis=2)
    mask = dist > tol

    # Remove isolated near-background speckles via connected components
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n_labels > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = np.zeros(n_labels, dtype=bool)
        for lbl_idx, area in enumerate(areas, start=1):
            if area >= min_area:
                keep[lbl_idx] = True
            elif area >= 4 and dist[labels == lbl_idx].max() > tol * 2.5:
                keep[lbl_idx] = True
        mask = keep[labels]
    return mask


def _segments_from_proj(prof: np.ndarray, threshold: float, min_gap: int, min_len: int) -> list[tuple[int, int]]:
    """Group active indices in a 1D projection into [start, end) segments."""
    active = np.nonzero(prof > threshold)[0]
    segs: list[list[int]] = []
    for idx in active:
        i = int(idx)
        if segs and i - segs[-1][1] <= min_gap:
            segs[-1][1] = i + 1
        else:
            segs.append([i, i + 1])
    return [(s, e) for s, e in segs if e - s >= min_len]


def _split_cuts_from_segs(segs: list[tuple[int, int]], total_len: int) -> list[int]:
    """Convert contiguous content segments into outer/midpoint boundary cuts."""
    cuts = [0]
    for (_, e0), (s1, _) in zip(segs, segs[1:]):
        cuts.append((e0 + s1) // 2)
    cuts.append(total_len)
    return cuts


def _even_minima_cuts(prof: np.ndarray, n: int, total_len: int) -> list[int]:
    """Fall back to even splits nudged to the emptiest nearby projection column/row."""
    smooth = np.convolve(prof.astype(np.float64), np.ones(5), mode="same")
    cuts = [0]
    search_r = max(1, int(total_len / n * 0.35))
    for k in range(1, n):
        expected = int(round(total_len * k / n))
        lo = max(cuts[-1] + 1, expected - search_r)
        hi = min(total_len - (n - k), expected + search_r + 1)
        if lo < hi:
            best = lo + int(np.argmin(smooth[lo:hi]))
        else:
            best = expected
        cuts.append(best)
    cuts.append(total_len)
    return cuts


def detect_cells(mask: np.ndarray, rows: int, cols: int) -> list[tuple[int, int, int, int]]:
    """Detect R x C cell bounds from empty projection gaps, falling back to even split."""
    h, w = mask.shape
    row_proj = mask.sum(axis=1)
    min_row_len = max(4, h // (rows * 6))
    min_row_gap = max(2, h // (rows * 16))

    row_segs = None
    for th in (0.0, w * 0.002, w * 0.005, w * 0.01, w * 0.02):
        cand = _segments_from_proj(row_proj, th, min_row_gap, min_row_len)
        if len(cand) == rows:
            row_segs = cand
            break
    row_cuts = _split_cuts_from_segs(row_segs, h) if row_segs is not None else _even_minima_cuts(row_proj, rows, h)

    cells: list[tuple[int, int, int, int]] = []
    min_col_len = max(4, w // (cols * 6))
    min_col_gap = max(2, w // (cols * 16))

    for r in range(rows):
        y0, y1 = row_cuts[r], row_cuts[r + 1]
        rh = max(1, y1 - y0)
        col_proj = mask[y0:y1].sum(axis=0)
        col_segs = None
        for th in (0.0, rh * 0.002, rh * 0.005, rh * 0.01, rh * 0.02):
            cand = _segments_from_proj(col_proj, th, min_col_gap, min_col_len)
            if len(cand) == cols:
                col_segs = cand
                break
        col_cuts = _split_cuts_from_segs(col_segs, w) if col_segs is not None else _even_minima_cuts(col_proj, cols, w)
        for c in range(cols):
            cells.append((col_cuts[c], y0, col_cuts[c + 1], y1))

    non_empty = sum(1 for (x0, y0, x1, y1) in cells if mask[y0:y1, x0:x1].any())
    if non_empty != rows * cols:
        raise ValueError(f"Expected {rows}x{cols}={rows * cols} non-empty cells, found {non_empty}")
    return cells


def _ground_band_mask(alpha: np.ndarray, bot_y: int, band_h: int) -> np.ndarray:
    """Extract a (band_h, w) boolean mask from baseline (bot_y) upward."""
    w = alpha.shape[1]
    band = np.zeros((band_h, w), dtype=bool)
    y_start = max(0, bot_y - band_h + 1)
    rows = alpha[y_start : bot_y + 1] > 0
    band[band_h - rows.shape[0] :] = rows
    return band


def _band_iou(mask_a: np.ndarray, x_a: int, mask_b: np.ndarray, x_b: int) -> float:
    """Compute IoU between two ground-band masks placed at horizontal offsets x_a and x_b."""
    w_a = mask_a.shape[1]
    w_b = mask_b.shape[1]
    ox0 = max(x_a, x_b)
    ox1 = min(x_a + w_a, x_b + w_b)
    if ox1 <= ox0:
        return 0.0
    inter = int((mask_a[:, ox0 - x_a : ox1 - x_a] & mask_b[:, ox0 - x_b : ox1 - x_b]).sum())
    if inter == 0:
        return 0.0
    union = int(mask_a.sum() + mask_b.sum() - inter)
    return inter / union if union > 0 else 0.0


def _foot_median_x(band: np.ndarray) -> float | None:
    """Median horizontal coordinate of opaque pixels inside a ground band."""
    xs = np.nonzero(band)[1]
    return float(np.median(xs)) if len(xs) else None


def slice_sheets(
    images: list[np.ndarray],
    rows: int,
    cols: int,
    target_height: int,
    lock_feet: bool = True,
    search_radius: int = 25,
    quiet: bool = False,
) -> tuple[list[Image.Image], dict]:
    """Slice one or more sheet RGB arrays into aligned, uniformly scaled RGBA frames."""
    extracted = []
    heights = []

    for rgb in images:
        mask = compute_fg_mask(rgb)
        cells = detect_cells(mask, rows, cols)
        for x0, y0, x1, y1 in cells:
            cm = mask[y0:y1, x0:x1]
            ys, xs = np.nonzero(cm)
            bx0 = x0 + int(xs.min())
            bx1 = x0 + int(xs.max()) + 1
            by0 = y0 + int(ys.min())
            by1 = y0 + int(ys.max()) + 1
            cell_cx = 0.5 * (x0 + x1)

            crop_rgb = rgb[by0:by1, bx0:bx1]
            crop_alpha = (mask[by0:by1, bx0:bx1].astype(np.uint8)) * 255
            rgba = np.dstack([crop_rgb, crop_alpha])
            extracted.append((rgba, cell_cx - bx0))
            heights.append(by1 - by0)

    median_h = float(np.median(heights))
    if median_h <= 0:
        raise ValueError("Detected median character height is zero")
    scale = target_height / median_h

    band_h = max(2, int(round(target_height * 0.12)))
    scaled = []
    for rgba, rel_cx in extracted:
        bh, bw, _ = rgba.shape
        sw = max(1, int(round(bw * scale)))
        sh = max(1, int(round(bh * scale)))
        pil_crop = Image.fromarray(rgba, mode="RGBA").resize((sw, sh), Image.Resampling.NEAREST)
        arr = np.asarray(pil_crop)
        ys = np.nonzero(arr[..., 3] > 0)[0]
        if len(ys) == 0:
            raise ValueError("Frame became empty after scaling")
        bot_y = int(ys.max())
        cx_offset = int(round(rel_cx * scale))
        band = _ground_band_mask(arr[..., 3], bot_y, band_h)
        scaled.append((pil_crop, sw, sh, cx_offset, bot_y, band))

    base_xs = [-cx_off for _, _, _, cx_off, _, _ in scaled]
    placed_xs = list(base_xs)

    if lock_feet and len(scaled) > 1:
        prev_accum = 0
        if not quiet:
            print("frame  0: shift=  +0 px, iou=1.000")
        for i in range(1, len(scaled)):
            band_prev = scaled[i - 1][5]
            band_curr = scaled[i][5]
            if not band_prev.any() or not band_curr.any():
                print(f"WARNING: frame {i} empty ground band, falling back to shift 0")
                placed_xs[i] = base_xs[i]
                prev_accum = 0
                if not quiet:
                    print(f"frame {i:2d}: shift=  +0 px, iou=0.000 (fallback)")
                continue

            best_s = 0
            best_iou = -1.0
            center_x = base_xs[i] + prev_accum
            for s in range(-search_radius, search_radius + 1):
                iou = _band_iou(band_prev, placed_xs[i - 1], band_curr, center_x + s)
                if iou > best_iou or (iou == best_iou and abs(s) < abs(best_s)):
                    best_iou = iou
                    best_s = s

            if best_iou < 1e-6:
                print(f"WARNING: frame {i} ground band IoU ~0 ({best_iou:.4f}), falling back to shift 0")
                placed_xs[i] = base_xs[i]
                prev_accum = 0
                if not quiet:
                    print(f"frame {i:2d}: shift=  +0 px, iou={best_iou:.3f} (fallback)")
            else:
                placed_xs[i] = center_x + best_s
                prev_accum = placed_xs[i] - base_xs[i]
                if not quiet:
                    print(f"frame {i:2d}: shift={prev_accum:+4d} px, iou={best_iou:.3f}")

        # Report largest frame-to-frame support-foot movement before vs after
        medians = [_foot_median_x(item[5]) for item in scaled]
        steps_before = [
            abs((base_xs[i] + medians[i]) - (base_xs[i - 1] + medians[i - 1]))
            for i in range(1, len(scaled))
            if medians[i] is not None and medians[i - 1] is not None
        ]
        steps_after = [
            abs((placed_xs[i] + medians[i]) - (placed_xs[i - 1] + medians[i - 1]))
            for i in range(1, len(scaled))
            if medians[i] is not None and medians[i - 1] is not None
        ]
        if not quiet and steps_before and steps_after:
            print(
                f"max frame-to-frame foot movement: before={max(steps_before):.1f} px, "
                f"after={max(steps_after):.1f} px"
            )

    pad = 2
    min_x = min(placed_xs[i] for i in range(len(scaled)))
    max_x = max(placed_xs[i] + scaled[i][1] for i in range(len(scaled)))
    max_above = max(item[4] for item in scaled)

    canvas_w = int((max_x - min_x) + 2 * pad)
    canvas_h = int(max_above + 1 + pad)
    offset_x = int(-min_x + pad)
    baseline_y = int(max_above + pad)

    out_frames: list[Image.Image] = []
    for i, (pil_crop, _, _, _, bot_y, _) in enumerate(scaled):
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        paste_x = placed_xs[i] + offset_x
        paste_y = baseline_y - bot_y
        canvas.paste(pil_crop, (paste_x, paste_y))
        out_frames.append(canvas)

    meta = {
        "frames": len(out_frames),
        "w": canvas_w,
        "h": canvas_h,
        "baseline_y": baseline_y,
    }
    return out_frames, meta


def save_outputs(frames: list[Image.Image], meta: dict, out_dir: Path, name: str, fps: float) -> None:
    """Write individual PNGs, horizontal strip, preview GIF on #3a3446, and metadata JSON."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for idx, frame in enumerate(frames):
        frame.save(out_dir / f"{name}_{idx:02d}.png")

    w, h = meta["w"], meta["h"]
    strip = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for idx, frame in enumerate(frames):
        strip.paste(frame, (idx * w, 0))
    strip.save(out_dir / f"{name}_strip.png")

    gif_frames = []
    for frame in frames:
        bg = Image.new("RGBA", (w, h), (*BG_PREVIEW_RGB, 255))
        bg.alpha_composite(frame)
        gif_frames.append(bg.convert("RGB"))
    gif_frames[0].save(
        out_dir / f"{name}.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=round(1000 / fps),
        loop=0,
    )

    out_meta = {
        "frames": meta["frames"],
        "fps": fps,
        "w": w,
        "h": h,
        "baseline_y": meta["baseline_y"],
    }
    (out_dir / f"{name}.json").write_text(json.dumps(out_meta, indent=2) + "\n", encoding="utf-8")


def run_selftest() -> None:
    """Build a synthetic 2x3 sheet with uneven gutters & varying blob heights, slice, and assert."""
    bg = (58, 52, 70)
    sheet_w, sheet_h = 460, 320
    img = np.full((sheet_h, sheet_w, 3), bg, dtype=np.uint8)

    # Uneven row bands and column bands
    row_ranges = [(14, 130), (168, 304)]
    col_ranges = [(12, 132), (162, 300), (324, 446)]
    blob_heights = [42, 56, 48, 64, 50, 44]
    blob_colors = [
        (255, 80, 80),
        (80, 170, 255),
        (255, 165, 50),
        (64, 224, 208),
        (230, 230, 90),
        (210, 120, 255),
    ]

    idx = 0
    for y0, y1 in row_ranges:
        for x0, x1 in col_ranges:
            bh = blob_heights[idx]
            bw = 26 + (idx % 3) * 6
            cx = (x0 + x1) // 2 + (idx % 2) * 8 - 4
            by1 = y1 - 8
            by0 = by1 - bh
            bx0 = cx - bw // 2
            bx1 = bx0 + bw
            img[by0:by1, bx0:bx1] = blob_colors[idx]
            idx += 1

    frames, meta = slice_sheets([img], rows=2, cols=3, target_height=96, quiet=True)
    assert len(frames) == 6, f"Expected 6 frames, got {len(frames)}"
    assert meta["frames"] == 6
    w, h = meta["w"], meta["h"]
    baseline_y = meta["baseline_y"]

    for i, fr in enumerate(frames):
        assert fr.size == (w, h), f"Frame {i} size {fr.size} != {(w, h)}"
        arr = np.asarray(fr)
        assert arr[0, 0, 3] == 0, f"Frame {i} top-left should be transparent"
        ys = np.nonzero(arr[..., 3] > 0)[0]
        assert len(ys) > 0, f"Frame {i} has no opaque pixels"
        assert int(ys.max()) == baseline_y, f"Frame {i} bottom {ys.max()} != baseline {baseline_y}"

    # Foot-locking test: synthetic 2x3 sheet where each cell has a random sideways offset,
    # but the "foot" block at the bottom must end up at the same x (±1 px) in every frame.
    rng = np.random.default_rng(42)
    offsets = rng.integers(-12, 13, size=6)
    img2 = np.full((320, 480, 3), bg, dtype=np.uint8)
    r_bands = [(12, 144), (168, 304)]
    c_bands = [(10, 150), (166, 310), (326, 470)]
    idx = 0
    for y0, y1 in r_bands:
        for x0, x1 in c_bands:
            cx = (x0 + x1) // 2 + int(offsets[idx])
            by1 = y1 - 8
            # Torso leaning slightly differently per frame (wide enough for gap-based cell detection)
            lean = (idx - 2) * 2
            img2[by1 - 96 : by1 - 12, cx - 18 + lean : cx + 18 + lean] = (200, 200, 220)
            # Fixed-width foot block at the bottom
            img2[by1 - 12 : by1, cx - 6 : cx + 6] = (255, 160, 48)
            idx += 1

    frames2, meta2 = slice_sheets([img2], rows=2, cols=3, target_height=96, lock_feet=True, quiet=True)
    foot_xs = []
    for i, fr in enumerate(frames2):
        arr = np.asarray(fr)
        band = arr[meta2["baseline_y"] - 8 : meta2["baseline_y"] + 1, :, 3] > 0
        xs = np.nonzero(band)[1]
        assert len(xs) > 0, f"Foot-lock selftest frame {i} has empty foot band"
        foot_xs.append(float(np.median(xs)))
    assert max(abs(x - foot_xs[0]) for x in foot_xs) <= 1.0, f"Foot drifted: {foot_xs}"

    print(f"SELFTEST PASSED: 6 frames, size={w}x{h}, baseline_y={baseline_y}; foot-lock spread={max(foot_xs)-min(foot_xs):.1f} px")


def main() -> None:
    parser = argparse.ArgumentParser(description="Slice Gemini sprite sheet(s) into aligned RGBA game frames.")
    parser.add_argument("sheets", nargs="*", help="Input sheet image path(s) in order")
    parser.add_argument("--rows", type=int, help="Number of grid rows per sheet")
    parser.add_argument("--cols", type=int, help="Number of grid columns per sheet")
    parser.add_argument("--name", help="Animation name prefix for outputs")
    parser.add_argument("--height", type=int, default=96, help="Target median character height in px (default: 96)")
    parser.add_argument("--fps", type=float, default=24, help="Preview GIF / metadata fps (default: 24)")
    parser.add_argument("--out", help="Output directory (default: art/frames/NAME)")
    parser.add_argument("--no-lock", action="store_true", help="Disable ground-band foot locking (keep cell-centre x)")
    parser.add_argument("--selftest", action="store_true", help="Run synthetic 2x3 sheet self-test")
    args = parser.parse_args()

    if args.selftest:
        run_selftest()
        return

    if not args.sheets or args.rows is None or args.cols is None or not args.name:
        parser.error("sheets, --rows, --cols, and --name are required unless --selftest is specified")

    images = [np.asarray(Image.open(p).convert("RGB")) for p in args.sheets]
    frames, meta = slice_sheets(images, args.rows, args.cols, args.height, lock_feet=not args.no_lock)
    out_dir = Path(args.out) if args.out else ROOT / "art" / "frames" / args.name
    save_outputs(frames, meta, out_dir, args.name, args.fps)
    print(f"sliced {meta['frames']} frames ({meta['w']}x{meta['h']}, baseline_y={meta['baseline_y']}) -> {out_dir}")


if __name__ == "__main__":
    main()
