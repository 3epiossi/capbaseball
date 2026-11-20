# 讀取 YOLO 2D 姿勢軌跡與原始投球影片，修正左右標記互換、內插低信心點並高斯平滑後，
# 以相同取景變換輸出正面（影片攝影機視角）5x6 火柴人姿勢參考圖、實拍裁切對照圖與檢查用 GIF。
# 用法：uv run --with pillow --with numpy --with opencv-python python capbaseball/art/make_pose_ref.py
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
POSE_PATH = ROOT / "pose" / "pitch" / "蔡寰亞_投球_pose.json"
VIDEO_PATH = Path("/Users/chang/Pictures/投球.mov")
OUT_DIR = ROOT / "art" / "ref"

CELL = 256
GAP = 8
ROWS = 5
COLS = 6
N_SAMPLES = 60
FPS = 24
BG_RGB = (58, 52, 70)   # #3a3446
BG_BGR = (70, 52, 58)

COL_RIGHT_ARM = (255, 74, 74)   # #ff4a4a (throwing arm)
COL_LEFT_ARM = (74, 168, 255)   # #4aa8ff
COL_RIGHT_LEG = (255, 160, 48)  # #ffa030
COL_LEFT_LEG = (64, 224, 208)   # #40e0d0
COL_TORSO = (255, 255, 255)     # white

LINE_WIDTH = 9
CONF_THRESH = 0.3
KP_SIGMA = 1.5
HIP_SIGMA = 3.0
SHOE_MARGIN_PX = 6.0

LR_PAIRS = [
    ("eye", "left_eye", "right_eye"),
    ("ear", "left_ear", "right_ear"),
    ("shoulder", "left_shoulder", "right_shoulder"),
    ("elbow", "left_elbow", "right_elbow"),
    ("wrist", "left_wrist", "right_wrist"),
    ("hip", "left_hip", "right_hip"),
    ("knee", "left_knee", "right_knee"),
    ("ankle", "left_ankle", "right_ankle"),
]

HEAD_KPS = ("nose", "left_eye", "right_eye", "left_ear", "right_ear")


def gaussian_smooth_1d(arr: np.ndarray, sigma: float) -> np.ndarray:
    """Smooth a 1D sequence with a Gaussian kernel using nearest-edge padding."""
    radius = int(math.ceil(3.0 * sigma))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-0.5 * (x / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(arr, radius, mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def fix_lr_swaps(frames: list[dict], swap_penalty: float = 15.0) -> dict[str, list[int]]:
    """Use Viterbi DP per L/R pair to detect and undo frames where YOLO swapped left and right."""
    n_frames = len(frames)
    fixed: dict[str, list[int]] = {}
    for pair_name, left_k, right_k in LR_PAIRS:
        pts_l = np.array([f["keypoints"][left_k][:2] for f in frames], dtype=np.float64)
        pts_r = np.array([f["keypoints"][right_k][:2] for f in frames], dtype=np.float64)

        dp = np.full((n_frames, 2), 1e18, dtype=np.float64)
        back = np.zeros((n_frames, 2), dtype=int)
        dp[0, 0] = 0.0

        for t in range(1, n_frames):
            for s_cur in (0, 1):
                lc = pts_r[t] if s_cur else pts_l[t]
                rc = pts_l[t] if s_cur else pts_r[t]
                best_cost = 1e18
                best_prev = 0
                for s_prv in (0, 1):
                    lp = pts_r[t - 1] if s_prv else pts_l[t - 1]
                    rp = pts_l[t - 1] if s_prv else pts_r[t - 1]
                    step = float(np.linalg.norm(lc - lp) + np.linalg.norm(rc - rp))
                    cost = dp[t - 1, s_prv] + step + (swap_penalty if s_cur else 0.0)
                    if cost < best_cost:
                        best_cost = cost
                        best_prev = s_prv
                dp[t, s_cur] = best_cost
                back[t, s_cur] = best_prev

        state = int(np.argmin(dp[n_frames - 1]))
        states = [0] * n_frames
        for t in range(n_frames - 1, -1, -1):
            states[t] = state
            state = int(back[t, state])

        swapped_frames = [t for t, st in enumerate(states) if st == 1]
        if swapped_frames:
            fixed[pair_name] = swapped_frames
            for t in swapped_frames:
                kps = frames[t]["keypoints"]
                kps[left_k], kps[right_k] = kps[right_k], kps[left_k]
    return fixed


def interpolate_and_smooth(frames: list[dict], kp_names: list[str]) -> np.ndarray:
    """Interpolate low-confidence keypoints (conf < CONF_THRESH) and Gaussian-smooth over time."""
    n_frames = len(frames)
    n_kps = len(kp_names)
    coords = np.zeros((n_frames, n_kps, 2), dtype=np.float64)
    all_t = np.arange(n_frames, dtype=np.float64)

    for j, name in enumerate(kp_names):
        raw = np.array([f["keypoints"][name] for f in frames], dtype=np.float64)
        valid = raw[:, 2] >= CONF_THRESH
        if valid.sum() >= 2:
            x = np.interp(all_t, all_t[valid], raw[valid, 0])
            y = np.interp(all_t, all_t[valid], raw[valid, 1])
        elif valid.sum() == 1:
            x = np.full(n_frames, raw[valid, 0][0], dtype=np.float64)
            y = np.full(n_frames, raw[valid, 1][0], dtype=np.float64)
        else:
            x = raw[:, 0]
            y = raw[:, 1]
        coords[:, j, 0] = gaussian_smooth_1d(x, KP_SIGMA)
        coords[:, j, 1] = gaussian_smooth_1d(y, KP_SIGMA)
    return coords


def draw_stick_cell(pts: dict[str, tuple[float, float]], scale: float) -> np.ndarray:
    """Draw one 256x256 stick-figure cell in RGB with fixed limb order."""
    img = np.full((CELL, CELL, 3), BG_RGB, dtype=np.uint8)

    def ip(name: str) -> tuple[int, int]:
        return (int(round(pts[name][0])), int(round(pts[name][1])))

    def draw_chain(names: list[str], color: tuple[int, int, int]) -> None:
        for a, b in zip(names, names[1:]):
            cv2.line(img, ip(a), ip(b), color, thickness=LINE_WIDTH, lineType=cv2.LINE_AA)

    # Fixed far-to-near order for right-handed pitcher facing camera:
    # left arm -> left leg -> torso -> neck & head -> right leg -> right arm
    draw_chain(["left_shoulder", "left_elbow", "left_wrist"], COL_LEFT_ARM)
    draw_chain(["left_hip", "left_knee", "left_ankle"], COL_LEFT_LEG)

    torso_poly = np.array(
        [ip("left_shoulder"), ip("right_shoulder"), ip("right_hip"), ip("left_hip")],
        dtype=np.int32,
    )
    cv2.fillPoly(img, [torso_poly], COL_TORSO, lineType=cv2.LINE_AA)

    sh_mid = (
        0.5 * (pts["left_shoulder"][0] + pts["right_shoulder"][0]),
        0.5 * (pts["left_shoulder"][1] + pts["right_shoulder"][1]),
    )
    head_pts = np.array([pts[k] for k in HEAD_KPS], dtype=np.float64)
    head_cx = float(head_pts[:, 0].mean())
    head_cy = float(head_pts[:, 1].mean())
    cv2.line(
        img,
        (int(round(sh_mid[0])), int(round(sh_mid[1]))),
        (int(round(head_cx)), int(round(head_cy))),
        COL_TORSO,
        thickness=LINE_WIDTH,
        lineType=cv2.LINE_AA,
    )

    span_x = float(head_pts[:, 0].max() - head_pts[:, 0].min())
    span_y = float(head_pts[:, 1].max() - head_pts[:, 1].min())
    rx = int(round(np.clip(span_x * 0.45, 18.0 * scale, 26.0 * scale)))
    ry = int(round(np.clip(max(span_y * 0.9, rx * 1.2), 22.0 * scale, 32.0 * scale)))
    cv2.ellipse(
        img,
        (int(round(head_cx)), int(round(head_cy))),
        (rx, ry),
        0,
        0,
        360,
        COL_TORSO,
        thickness=-1,
        lineType=cv2.LINE_AA,
    )

    draw_chain(["right_hip", "right_knee", "right_ankle"], COL_RIGHT_LEG)
    draw_chain(["right_shoulder", "right_elbow", "right_wrist"], COL_RIGHT_ARM)
    return img


def compose_grid(cells: list[np.ndarray]) -> Image.Image:
    """Assemble ROWS x COLS of 256x256 cells with GAP px #3a3446 gutters."""
    grid_w = COLS * CELL + (COLS - 1) * GAP
    grid_h = ROWS * CELL + (ROWS - 1) * GAP
    canvas = np.full((grid_h, grid_w, 3), BG_RGB, dtype=np.uint8)
    for idx, cell in enumerate(cells):
        r = idx // COLS
        c = idx % COLS
        y0 = r * (CELL + GAP)
        x0 = c * (CELL + GAP)
        canvas[y0 : y0 + CELL, x0 : x0 + CELL] = cell
    return Image.fromarray(canvas, mode="RGB")


def read_video_frames(video_path: Path, frame_indices: list[int]) -> tuple[dict[int, np.ndarray], int, int]:
    """Decode required video frames with OpenCV."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")
    vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    needed = set(frame_indices)
    max_idx = max(needed)
    decoded: dict[int, np.ndarray] = {}
    idx = 0
    while idx <= max_idx:
        ok, frame_bgr = cap.read()
        if not ok:
            break
        if idx in needed:
            decoded[idx] = frame_bgr
        idx += 1
    cap.release()
    missing = needed - set(decoded.keys())
    if missing:
        raise RuntimeError(f"Missing video frames: {sorted(missing)}")
    return decoded, vid_w, vid_h


def main() -> None:
    data = json.loads(POSE_PATH.read_text(encoding="utf-8"))
    frames = data["frames"]
    n_frames = len(frames)
    kp_names = list(frames[0]["keypoints"].keys())
    kp_idx = {name: i for i, name in enumerate(kp_names)}

    swapped_fixed = fix_lr_swaps(frames)
    coords = interpolate_and_smooth(frames, kp_names)

    # Hip midpoint Gaussian-smoothed over time (sigma = 3 frames)
    hip_mid_x = 0.5 * (coords[:, kp_idx["left_hip"], 0] + coords[:, kp_idx["right_hip"], 0])
    hip_cx_smooth = gaussian_smooth_1d(hip_mid_x, HIP_SIGMA)

    # Fixed scale and ground line across all 83 frames
    rel_x = coords[:, :, 0] - hip_cx_smooth[:, None]
    extent_x = float(rel_x.max() - rel_x.min())
    extent_y = float(coords[:, :, 1].max() - coords[:, :, 1].min())
    scale = CELL / (max(extent_x, extent_y) * 1.15)

    max_ankle_y = float(
        max(
            coords[:, kp_idx["left_ankle"], 1].max(),
            coords[:, kp_idx["right_ankle"], 1].max(),
        )
    )
    ground_y_px = CELL * (1.0 - 0.06) - SHOE_MARGIN_PX

    sampled_indices = [round(i * (n_frames - 1) / (N_SAMPLES - 1)) for i in range(N_SAMPLES)]
    video_frames, vid_w, vid_h = read_video_frames(VIDEO_PATH, sampled_indices)

    stick_cells: list[np.ndarray] = []
    photo_cells: list[np.ndarray] = []
    cutoff_frames: list[int] = []

    for t in sampled_indices:
        cx_vid = float(hip_cx_smooth[t])
        pts_cell = {
            name: (
                CELL * 0.5 + (float(coords[t, j, 0]) - cx_vid) * scale,
                ground_y_px + (float(coords[t, j, 1]) - max_ankle_y) * scale,
            )
            for j, name in enumerate(kp_names)
        }
        stick_cells.append(draw_stick_cell(pts_cell, scale))

        # Exact same affine transform on video frame
        tx = CELL * 0.5 - scale * cx_vid
        ty = ground_y_px - scale * max_ankle_y
        mat = np.array([[scale, 0.0, tx], [0.0, scale, ty]], dtype=np.float64)
        crop_bgr = cv2.warpAffine(
            video_frames[t],
            mat,
            (CELL, CELL),
            flags=cv2.INTER_AREA,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=BG_BGR,
        )
        photo_cells.append(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB))

        # Check if crop window or any keypoint is cut off by video edge
        vx0 = cx_vid - (CELL * 0.5) / scale
        vx1 = cx_vid + (CELL * 0.5) / scale
        vy0 = max_ankle_y - ground_y_px / scale
        vy1 = max_ankle_y + (CELL - ground_y_px) / scale
        kp_outside = bool(
            (coords[t, :, 0] < 0).any()
            or (coords[t, :, 0] >= vid_w).any()
            or (coords[t, :, 1] < 0).any()
            or (coords[t, :, 1] >= vid_h).any()
        )
        crop_outside = vx0 < 0 or vx1 > vid_w or vy0 < 0 or vy1 > vid_h
        if kp_outside or crop_outside:
            cutoff_frames.append(t)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pose_a = OUT_DIR / "pose-front-a.png"
    pose_b = OUT_DIR / "pose-front-b.png"
    photo_a = OUT_DIR / "photo-front-a.png"
    photo_b = OUT_DIR / "photo-front-b.png"
    pose_gif = OUT_DIR / "pose-front.gif"
    photo_gif = OUT_DIR / "photo-front.gif"

    compose_grid(stick_cells[:30]).save(pose_a)
    compose_grid(stick_cells[30:]).save(pose_b)
    compose_grid(photo_cells[:30]).save(photo_a)
    compose_grid(photo_cells[30:]).save(photo_b)

    for gif_path, cells in ((pose_gif, stick_cells), (photo_gif, photo_cells)):
        pil_frames = [Image.fromarray(c, mode="RGB") for c in cells]
        pil_frames[0].save(
            gif_path,
            save_all=True,
            append_images=pil_frames[1:],
            duration=round(1000 / FPS),
            loop=0,
        )

    print(f"scale: {scale:.4f} cell_px / video_px")
    print(f"swapped_frames_fixed: {swapped_fixed}")
    print(f"cutoff_frames (video edge): {cutoff_frames if cutoff_frames else 'none'}")
    print(f"wrote: {pose_a}, {pose_b}, {photo_a}, {photo_b}, {pose_gif}, {photo_gif}")


if __name__ == "__main__":
    main()
