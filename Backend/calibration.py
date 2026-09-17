import json
from pathlib import Path

import numpy as np

BASE_DIR = Path(__file__).resolve().parent
CALIBRATION_FILE = BASE_DIR / "calibration_data.json"


def load_calibration_data() -> list[dict]:
    if not CALIBRATION_FILE.exists():
        return []

    try:
        with CALIBRATION_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (json.JSONDecodeError, OSError):
        return []

    if not isinstance(data, list):
        return []

    cleaned = []
    for point in data:
        try:
            cleaned.append({
                "n": float(point.get("n", point.get("c"))),
                "delta_e": float(point["delta_e"]),
            })
        except (TypeError, ValueError, KeyError):
            continue
    return cleaned


def save_calibration_data(data: list[dict]) -> None:
    with CALIBRATION_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2, ensure_ascii=False)


def add_calibration_point(n: float, delta_e: float) -> list[dict]:
    n = float(n)
    delta_e = float(delta_e)
    if n < 0 or delta_e < 0:
        raise ValueError("Nồng độ N và ΔE không được âm.")

    data = load_calibration_data()
    data.append({"n": n, "delta_e": delta_e})
    data.sort(key=lambda p: p["n"])
    save_calibration_data(data)
    return data


def delete_calibration_point(index: int) -> list[dict]:
    data = load_calibration_data()
    if index < 0 or index >= len(data):
        raise IndexError("Điểm calibration không tồn tại.")
    data.pop(index)
    save_calibration_data(data)
    return data


def clear_calibration_data() -> None:
    save_calibration_data([])


def calculate_calibration() -> dict | None:
    """Fit ΔE = slope*N + intercept and return R². Needs >=2 points."""
    data = load_calibration_data()
    if len(data) < 2:
        return None

    n_values = np.array([p["n"] for p in data], dtype=float)
    delta_values = np.array([p["delta_e"] for p in data], dtype=float)

    if np.allclose(n_values, n_values[0]):
        raise ValueError("Các điểm calibration phải có ít nhất hai giá trị N khác nhau.")

    slope, intercept = np.polyfit(n_values, delta_values, 1)
    predicted = slope * n_values + intercept
    ss_res = float(np.sum((delta_values - predicted) ** 2))
    ss_tot = float(np.sum((delta_values - np.mean(delta_values)) ** 2))
    r_squared = 1.0 if np.isclose(ss_tot, 0.0) else 1.0 - ss_res / ss_tot

    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "r_squared": float(r_squared),
        "equation": "DeltaE = slope * N + intercept",
        "point_count": len(data),
        "n_min": float(np.min(n_values)),
        "n_max": float(np.max(n_values)),
    }


def estimate_concentration(delta_e: float) -> dict | None:
    model = calculate_calibration()
    if model is None:
        return None

    slope = model["slope"]
    if np.isclose(slope, 0.0):
        raise ValueError("Độ dốc của đường chuẩn bằng 0 nên không thể suy ra N.")

    raw_n = (float(delta_e) - model["intercept"]) / slope
    estimated_n = max(0.0, raw_n)
    in_range = model["n_min"] <= estimated_n <= model["n_max"]

    return {
        "value": float(estimated_n),
        "raw_value": float(raw_n),
        "within_calibration_range": bool(in_range),
    }
