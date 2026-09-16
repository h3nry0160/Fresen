import math


def _srgb_channel_to_linear(value: float) -> float:
    """Convert one sRGB channel (0..1) to linear RGB."""
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def _xyz_lab_f(value: float) -> float:
    delta = 6 / 29
    threshold = delta ** 3
    if value > threshold:
        return value ** (1 / 3)
    return value / (3 * delta ** 2) + 4 / 29


def rgb_to_lab(r: float, g: float, b: float) -> tuple[float, float, float]:
    """
    Convert sRGB (0..255) to CIE L*a*b* using D65 white.

    This avoids OpenCV's uint8 LAB quantisation and keeps the scientific
    calculation explicit for easier explanation in a school research project.
    """
    r_lin = _srgb_channel_to_linear(max(0.0, min(255.0, r)) / 255.0)
    g_lin = _srgb_channel_to_linear(max(0.0, min(255.0, g)) / 255.0)
    b_lin = _srgb_channel_to_linear(max(0.0, min(255.0, b)) / 255.0)

    # Linear sRGB -> XYZ (D65), scaled so Yn = 1.
    x = r_lin * 0.4124564 + g_lin * 0.3575761 + b_lin * 0.1804375
    y = r_lin * 0.2126729 + g_lin * 0.7151522 + b_lin * 0.0721750
    z = r_lin * 0.0193339 + g_lin * 0.1191920 + b_lin * 0.9503041

    # D65 reference white.
    xr = x / 0.95047
    yr = y / 1.00000
    zr = z / 1.08883

    fx = _xyz_lab_f(xr)
    fy = _xyz_lab_f(yr)
    fz = _xyz_lab_f(zr)

    L = 116 * fy - 16
    a = 500 * (fx - fy)
    b_value = 200 * (fy - fz)

    return float(L), float(a), float(b_value)


def calculate_delta_e(lab1: tuple[float, float, float], lab2: tuple[float, float, float]) -> float:
    """Calculate CIE76 Delta E (Euclidean distance in CIELAB)."""
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    return float(math.sqrt((L2 - L1) ** 2 + (a2 - a1) ** 2 + (b2 - b1) ** 2))
