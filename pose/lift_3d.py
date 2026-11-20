"""Extract 3D pose landmarks from 投球.mov using MediaPipe PoseLandmarker."""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

VIDEO_PATH = Path("/Users/chang/Pictures/投球.mov")
POSE_DIR = Path(__file__).resolve().parent
MODEL_PATH = POSE_DIR / "models" / "pose_landmarker_heavy.task"
YOLO_POSE_PATH = POSE_DIR / "pitch" / "蔡寰亞_投球_pose.json"
OUTPUT_PATH = POSE_DIR / "pitch" / "蔡寰亞_投球_pose3d.json"

LANDMARK_NAMES = [m.name.lower() for m in vision.PoseLandmark]
SANITY_FRAMES = (0, 40, 70)
SANITY_JOINTS = ("left_wrist", "right_wrist", "left_ankle", "right_ankle")


def round4(val: float) -> float:
    return round(float(val), 4)


def main() -> None:
    if not VIDEO_PATH.exists():
        raise FileNotFoundError(f"Video not found: {VIDEO_PATH}")
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

    cap = cv2.VideoCapture(str(VIDEO_PATH))
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {VIDEO_PATH}")

    fps_raw = cap.get(cv2.CAP_PROP_FPS) or 30.0
    fps = int(round(fps_raw)) if abs(fps_raw - round(fps_raw)) < 1e-3 else round4(fps_raw)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if (width, height) != (1920, 1080):
        raise RuntimeError(f"Expected 1920x1080 landscape video, got {width}x{height}")

    options = vision.PoseLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )

    frames_out: list[dict] = []
    detected_count = 0

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        frame_idx = 0
        while True:
            ret, bgr = cap.read()
            if not ret:
                break
            if bgr.shape[1] != 1920 or bgr.shape[0] != 1080:
                raise RuntimeError(
                    f"Frame {frame_idx} has unexpected shape {bgr.shape}, expected (1080, 1920, 3)"
                )

            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int(round(frame_idx * 1000.0 / float(fps_raw)))
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.pose_landmarks and result.pose_world_landmarks:
                detected_count += 1
                img_lms = result.pose_landmarks[0]
                world_lms = result.pose_world_landmarks[0]
                world_arr = [
                    [round4(lm.x), round4(lm.y), round4(lm.z), round4(lm.visibility or 0.0)]
                    for lm in world_lms
                ]
                image_arr = [
                    [
                        round4(lm.x * width),
                        round4(lm.y * height),
                        round4(lm.visibility or 0.0),
                    ]
                    for lm in img_lms
                ]
            else:
                world_arr = None
                image_arr = None

            frames_out.append(
                {
                    "frame_index": frame_idx,
                    "timestamp_sec": round4(frame_idx / float(fps_raw)),
                    "world": world_arr,
                    "image": image_arr,
                }
            )
            frame_idx += 1

    cap.release()

    payload = {
        "schema_version": 1,
        "meta": {
            "fps": fps,
            "video_path": VIDEO_PATH.name,
            "model": f"mediapipe pose_landmarker_heavy {mp.__version__}",
            "world_axes": (
                "MediaPipe PoseLandmarker pose_world_landmarks: origin at midpoint of left_hip "
                "and right_hip, in metres; image-aligned axes with +x right, +y down, +z away "
                "from camera (negative z toward camera), verified empirically on nose/hips/ankles"
            ),
        },
        "landmark_names": LANDMARK_NAMES,
        "frames": frames_out,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    # Sanity checks
    print(f"Detections: {detected_count}/{len(frames_out)} frames")

    with YOLO_POSE_PATH.open("r", encoding="utf-8") as f:
        yolo_data = json.load(f)
    yolo_by_idx = {fr["frame_index"]: fr["keypoints"] for fr in yolo_data["frames"]}
    name_to_idx = {name: idx for idx, name in enumerate(LANDMARK_NAMES)}

    large_dist_count = 0
    total_compared = 0
    for fidx in SANITY_FRAMES:
        mp_frame = frames_out[fidx]
        yolo_kps = yolo_by_idx.get(fidx, {})
        if mp_frame["image"] is None:
            print(f"Frame {fidx}: MediaPipe no detection")
            continue
        dists = []
        for jname in SANITY_JOINTS:
            mp_xy = mp_frame["image"][name_to_idx[jname]][:2]
            yolo_xy = yolo_kps[jname][:2]
            dist = math.hypot(mp_xy[0] - yolo_xy[0], mp_xy[1] - yolo_xy[1])
            total_compared += 1
            if dist > 80.0:
                large_dist_count += 1
            dists.append(f"{jname}={dist:.2f}px")
        print(f"Frame {fidx} vs YOLO: " + ", ".join(dists))

    if total_compared > 0 and large_dist_count > total_compared / 2:
        print(
            f"WARNING: {large_dist_count}/{total_compared} joints > 80px "
            "(possible wrong person or left/right swap)"
        )

    f40_world = frames_out[40]["world"]
    if f40_world is not None:
        zs = [pt[2] for pt in f40_world]
        z_min, z_max = min(zs), max(zs)
        print(f"Frame 40 world z-spread (max z - min z): {z_max - z_min:.4f} m (min={z_min:.4f}, max={z_max:.4f})")
        # Print nose & ankles world coords to verify axis signs
        nose_w = f40_world[name_to_idx["nose"]]
        l_hip_w = f40_world[name_to_idx["left_hip"]]
        r_hip_w = f40_world[name_to_idx["right_hip"]]
        l_ank_w = f40_world[name_to_idx["left_ankle"]]
        print(
            f"Frame 40 axis check (m): nose={nose_w[:3]}, "
            f"left_hip={l_hip_w[:3]}, right_hip={r_hip_w[:3]}, left_ankle={l_ank_w[:3]}"
        )
    else:
        print("Frame 40: no MediaPipe detection")


if __name__ == "__main__":
    main()
