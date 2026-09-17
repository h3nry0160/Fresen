from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from calibration import (
    add_calibration_point,
    calculate_calibration,
    clear_calibration_data,
    delete_calibration_point,
    estimate_concentration,
    load_calibration_data,
)
from image_analysis import analyze_delta_e

BASE_DIR = Path(__file__).resolve().parent
# Support both project layouts:
# 1) Backend/frontend
# 2) Backend and frontend as sibling folders (recommended for VS Code)
_FRONTEND_CANDIDATES = [
    BASE_DIR / "frontend",
    BASE_DIR.parent / "frontend",
]
FRONTEND_DIR = next((path for path in _FRONTEND_CANDIDATES if path.exists()), _FRONTEND_CANDIDATES[0])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
SAFE_N_THRESHOLD_MG_PER_100G = 30.0

app = FastAPI(
    title="Fresen API",
    version="1.1.0",
    description="pH-sensitive food-film colour analysis API",
)

# Same-origin serving is used in the supplied project. CORS is kept permissive
# during school-project development so a separate local frontend can still call it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CalibrationPointIn(BaseModel):
    n: float = Field(ge=0)
    delta_e: float = Field(ge=0)


def api_error(exc: Exception, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail=str(exc))


async def read_image(upload: UploadFile) -> bytes:
    if upload.content_type and not upload.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="File tải lên phải là hình ảnh.")

    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="File hình ảnh rỗng.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Mỗi ảnh phải nhỏ hơn 15 MB.")
    return content


@app.get("/api/health")
def health():
    return {"ok": True, "name": "Fresen API"}


@app.get("/api/calibration")
def get_calibration():
    try:
        return {
            "points": load_calibration_data(),
            "model": calculate_calibration(),
        }
    except Exception as exc:
        raise api_error(exc)


@app.post("/api/calibration")
def create_calibration_point(point: CalibrationPointIn):
    try:
        points = add_calibration_point(point.n, point.delta_e)
        return {"points": points, "model": calculate_calibration()}
    except Exception as exc:
        raise api_error(exc)


@app.delete("/api/calibration/{index}")
def remove_calibration_point(index: int):
    try:
        points = delete_calibration_point(index)
        return {"points": points, "model": calculate_calibration()}
    except IndexError as exc:
        raise api_error(exc, 404)
    except Exception as exc:
        raise api_error(exc)


@app.delete("/api/calibration")
def remove_all_calibration_points():
    clear_calibration_data()
    return {"points": [], "model": None}


@app.post("/api/analyze")
async def analyze(
    reference: UploadFile = File(...),
    sample: UploadFile = File(...),
    reference_x: float = Form(...),
    reference_y: float = Form(...),
    sample_x: float = Form(...),
    sample_y: float = Form(...),
    radius_ratio: float = Form(0.015),
):
    try:
        reference_bytes = await read_image(reference)
        sample_bytes = await read_image(sample)

        result = analyze_delta_e(
            reference_bytes,
            sample_bytes,
            reference_x,
            reference_y,
            sample_x,
            sample_y,
            radius_ratio,
        )

        model = calculate_calibration()
        estimate = estimate_concentration(result["deltaE"]) if model else None

        freshness = None
        if estimate is not None:
            estimated_n = float(estimate["value"])
            is_spoiled = estimated_n > SAFE_N_THRESHOLD_MG_PER_100G

            freshness = {
                "threshold": SAFE_N_THRESHOLD_MG_PER_100G,
                "unit": "mg/100g",
                "is_spoiled": is_spoiled,
                "status": "spoiled" if is_spoiled else "usable",
                "message": (
                    "Nồng độ N ước tính vượt 30 mg/100g. "
                    "Theo ngưỡng của dự án, thực phẩm được xếp vào nhóm đã hỏng và không nên sử dụng."
                    if is_spoiled
                    else
                    "Nồng độ N ước tính không vượt 30 mg/100g. "
                    "Theo ngưỡng của dự án, thực phẩm được xếp vào nhóm còn sử dụng."
                ),
            }

        return {
            **result,
            "estimated_n": estimate,
            "calibration": model,
            "freshness": freshness,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise api_error(exc)


@app.get("/")
def frontend_home():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
