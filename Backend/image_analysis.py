import cv2
import numpy as np

from color_analysis import rgb_to_lab, calculate_delta_e


def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode uploaded bytes into an OpenCV BGR image."""
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Không thể đọc hình ảnh.")
    return image


def _validate_ratio(value: float, name: str) -> float:
    value = float(value)
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} phải nằm trong khoảng 0 đến 1.")
    return value


def extract_point_roi(
    image: np.ndarray,
    x_ratio: float,
    y_ratio: float,
    radius_ratio: float = 0.015,
    min_radius_px: int = 4,
) -> tuple[np.ndarray, dict]:
    """
    Extract a square ROI around a point selected in the browser.

    x_ratio/y_ratio are normalised coordinates (0..1), so the same point works
    regardless of how large the image is displayed on phone or laptop.
    """
    x_ratio = _validate_ratio(x_ratio, "x_ratio")
    y_ratio = _validate_ratio(y_ratio, "y_ratio")

    if not 0.001 <= radius_ratio <= 0.15:
        raise ValueError("radius_ratio phải nằm trong khoảng 0.001 đến 0.15.")

    height, width = image.shape[:2]
    center_x = int(round(x_ratio * (width - 1)))
    center_y = int(round(y_ratio * (height - 1)))

    radius = max(min_radius_px, int(round(min(width, height) * radius_ratio)))

    x1 = max(0, center_x - radius)
    y1 = max(0, center_y - radius)
    x2 = min(width, center_x + radius + 1)
    y2 = min(height, center_y + radius + 1)

    roi = image[y1:y2, x1:x2]
    if roi.size == 0:
        raise ValueError("Vùng chọn trên ảnh không hợp lệ.")

    metadata = {
        "center_x": center_x,
        "center_y": center_y,
        "x_ratio": x_ratio,
        "y_ratio": y_ratio,
        "radius_px": radius,
        "bounds": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
        "pixel_count": int(roi.shape[0] * roi.shape[1]),
    }
    return roi, metadata


def extract_average_rgb(bgr_roi: np.ndarray) -> tuple[float, float, float]:
    """Return mean R, G, B values for an OpenCV BGR region."""
    mean_b, mean_g, mean_r = cv2.mean(bgr_roi)[:3]
    return float(mean_r), float(mean_g), float(mean_b)


def analyze_selected_region(
    image_bytes: bytes,
    x_ratio: float,
    y_ratio: float,
    radius_ratio: float = 0.015,
) -> dict:
    """Decode image -> selected ROI -> mean RGB -> CIELAB."""
    image = decode_image(image_bytes)
    roi, selection = extract_point_roi(image, x_ratio, y_ratio, radius_ratio)
    r, g, b = extract_average_rgb(roi)
    L, a, b_lab = rgb_to_lab(r, g, b)

    return {
        "rgb": {"r": round(r, 3), "g": round(g, 3), "b": round(b, 3)},
        "lab": {"L": round(L, 3), "a": round(a, 3), "b": round(b_lab, 3)},
        "selection": selection,
    }


def analyze_delta_e(
    reference_image_bytes: bytes,
    sample_image_bytes: bytes,
    reference_x_ratio: float,
    reference_y_ratio: float,
    sample_x_ratio: float,
    sample_y_ratio: float,
    radius_ratio: float = 0.015,
) -> dict:
    """Analyze selected ROIs in two images and calculate CIE76 Delta E."""
    reference = analyze_selected_region(
        reference_image_bytes, reference_x_ratio, reference_y_ratio, radius_ratio
    )
    sample = analyze_selected_region(
        sample_image_bytes, sample_x_ratio, sample_y_ratio, radius_ratio
    )

    reference_lab = (
        reference["lab"]["L"],
        reference["lab"]["a"],
        reference["lab"]["b"],
    )
    sample_lab = (
        sample["lab"]["L"],
        sample["lab"]["a"],
        sample["lab"]["b"],
    )

    delta_e = calculate_delta_e(reference_lab, sample_lab)
    return {
        "reference": reference,
        "sample": sample,
        "deltaE": round(delta_e, 3),
        "deltaE_method": "CIE76",
    }
