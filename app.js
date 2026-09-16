const $ = id => document.getElementById(id);
const API = "/api";

function loadSavedHistory() {
    try {
        const value = JSON.parse(localStorage.getItem("fresenHistory") || "[]");
        return Array.isArray(value) ? value : [];
    } catch (_) {
        localStorage.removeItem("fresenHistory");
        return [];
    }
}

const state = {
    calibration: [],
    model: null,
    sampleFile: null,
    referenceFile: null,
    samplePoint: null,
    referencePoint: null,
    history: loadSavedHistory(),
};

function showPage(pageId) {
    document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === pageId));
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageId));
    if (pageId === "history") renderHistory();
    if (pageId === "calibration") drawCalibrationChart();
}

document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));
document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.go)));

async function apiFetch(url, options = {}) {
    const response = await fetch(url, options);
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(payload?.detail || `HTTP ${response.status}`);
    return payload;
}

async function checkApi() {
    try {
        await apiFetch(`${API}/health`);
        $("apiStatus").textContent = "Backend Python đã kết nối.";
        $("apiStatus").className = "api-status ok";
    } catch (error) {
        $("apiStatus").textContent = "Không kết nối được backend. Hãy chạy FastAPI bằng uvicorn.";
        $("apiStatus").className = "api-status error";
    }
}

function setImage(kind, file) {
    if (!file) return;

    const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    const supportedExtension = /\.(jpe?g|png|webp)$/i.test(file.name || "");

    if ((!supportedTypes.has(file.type) && !supportedExtension)) {
        return alert(
            "Fresen hiện hỗ trợ JPG/JPEG, PNG và WEBP. " +
            "Nếu ảnh điện thoại là HEIC/HEIF, hãy đổi sang JPEG hoặc chụp lại ở chế độ tương thích."
        );
    }

    const isSample = kind === "sample";
    state[isSample ? "sampleFile" : "referenceFile"] = file;
    state[isSample ? "samplePoint" : "referencePoint"] = null;

    const preview = $(isSample ? "preview" : "referencePreview");
    const selector = $(isSample ? "sampleImageSelector" : "referenceImageSelector");
    const placeholder = $(isSample ? "samplePlaceholder" : "referencePlaceholder");
    const crosshair = $(isSample ? "sampleCrosshair" : "referenceCrosshair");
    const status = $(isSample ? "sampleSelectionStatus" : "referenceSelectionStatus");

    const oldUrl = preview.dataset.objectUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const url = URL.createObjectURL(file);
    preview.dataset.objectUrl = url;
    preview.src = url;
    preview.onload = () => {
        selector.classList.remove("hidden");
        placeholder.classList.add("hidden");
        crosshair.classList.add("hidden");
        status.textContent = "Nhấn vào vùng màng cần phân tích.";
        updateAnalyzeButton();
    };
}

function bindFileInput(id, kind) {
    $(id).addEventListener("change", event => setImage(kind, event.target.files?.[0]));
}
bindFileInput("cameraInput", "sample");
bindFileInput("galleryInput", "sample");
bindFileInput("referenceCameraInput", "reference");
bindFileInput("referenceInput", "reference");

function getPoint(image, clientX, clientY) {
    const rect = image.getBoundingClientRect();
    if (!image.naturalWidth || !image.naturalHeight || rect.width === 0 || rect.height === 0) return null;

    // The <img> itself keeps its intrinsic aspect ratio (height:auto), therefore
    // the displayed bitmap fills its own bounding box without letterboxing.
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    return { xRatio: x / rect.width, yRatio: y / rect.height };
}

function positionCrosshair(crosshair, image, point) {
    const imageRect = image.getBoundingClientRect();
    const parent = crosshair.offsetParent;

    if (!parent || imageRect.width === 0 || imageRect.height === 0) return;

    const parentRect = parent.getBoundingClientRect();
    const imageLeft = imageRect.left - parentRect.left;
    const imageTop = imageRect.top - parentRect.top;

    crosshair.style.left = `${imageLeft + point.xRatio * imageRect.width}px`;
    crosshair.style.top = `${imageTop + point.yRatio * imageRect.height}px`;
    crosshair.classList.remove("hidden");
}

function bindPointSelection(kind, imageId, crosshairId, statusId) {
    $(imageId).addEventListener("pointerdown", event => {
        event.preventDefault();
        const point = getPoint($(imageId), event.clientX, event.clientY);
        if (!point) return;
        state[kind === "sample" ? "samplePoint" : "referencePoint"] = point;
        positionCrosshair($(crosshairId), $(imageId), point);
        $(statusId).textContent = `Đã chọn X ${(point.xRatio * 100).toFixed(1)}% · Y ${(point.yRatio * 100).toFixed(1)}%`;
        updateAnalyzeButton();
    });
}
bindPointSelection("sample", "preview", "sampleCrosshair", "sampleSelectionStatus");
bindPointSelection("reference", "referencePreview", "referenceCrosshair", "referenceSelectionStatus");

function bindDropArea(id, kind) {
    const area = $(id);
    ["dragenter", "dragover"].forEach(name => area.addEventListener(name, event => {
        event.preventDefault(); area.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach(name => area.addEventListener(name, event => {
        event.preventDefault(); area.classList.remove("dragging");
    }));
    area.addEventListener("drop", event => setImage(kind, event.dataTransfer.files?.[0]));
}
bindDropArea("sampleDropArea", "sample");
bindDropArea("referenceDropArea", "reference");

function updateAnalyzeButton() {
    $("analyzeBtn").disabled = !(state.sampleFile && state.referenceFile && state.samplePoint && state.referencePoint);
}

$("roiRadius").addEventListener("input", () => {
    $("roiRadiusLabel").textContent = `${Number($("roiRadius").value).toFixed(1)}%`;
});

async function loadCalibration() {
    try {
        const result = await apiFetch(`${API}/calibration`);
        state.calibration = result.points || [];
        state.model = result.model || null;
        renderCalibration();
    } catch (error) {
        $("calibrationTable").innerHTML = `<p class="hint">Không tải được dữ liệu: ${escapeHTML(error.message)}</p>`;
    }
}

$("addCalPoint").addEventListener("click", async () => {
    const n = Number($("calN").value);
    const delta_e = Number($("calDE").value);
    if (!Number.isFinite(n) || !Number.isFinite(delta_e) || n < 0 || delta_e < 0) return alert("Nhập N và ΔE hợp lệ (không âm).");

    try {
        const result = await apiFetch(`${API}/calibration`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ n, delta_e }),
        });
        state.calibration = result.points;
        state.model = result.model;
        $("calN").value = "";
        $("calDE").value = "";
        renderCalibration();
    } catch (error) { alert(error.message); }
});

$("clearCalibration").addEventListener("click", async () => {
    if (!confirm("Xóa toàn bộ dữ liệu đường chuẩn?")) return;
    try {
        await apiFetch(`${API}/calibration`, { method: "DELETE" });
        state.calibration = [];
        state.model = null;
        renderCalibration();
    } catch (error) { alert(error.message); }
});

window.deleteCalibration = async index => {
    try {
        const result = await apiFetch(`${API}/calibration/${index}`, { method: "DELETE" });
        state.calibration = result.points;
        state.model = result.model;
        renderCalibration();
    } catch (error) { alert(error.message); }
};

function renderCalibration() {
    const container = $("calibrationTable");
    if (!state.calibration.length) {
        container.innerHTML = `<p class="hint">Chưa có điểm calibration.</p>`;
    } else {
        container.innerHTML = `<table><thead><tr><th>#</th><th>N</th><th>ΔE</th><th></th></tr></thead><tbody>${state.calibration.map((p, i) => `
            <tr><td>${i + 1}</td><td>${format(p.n, 4)}</td><td>${format(p.delta_e, 4)}</td><td><button class="button secondary" onclick="deleteCalibration(${i})">Xóa</button></td></tr>`).join("")}
        </tbody></table>`;
    }

    if (state.model) {
        const m = state.model;
        $("regressionInfo").innerHTML = `ΔE = <strong>${m.slope.toFixed(5)} × N ${m.intercept >= 0 ? "+" : "−"} ${Math.abs(m.intercept).toFixed(5)}</strong><br>R² = <strong>${m.r_squared.toFixed(5)}</strong> · ${m.point_count} điểm`;
    } else {
        $("regressionInfo").textContent = "Cần ít nhất 2 điểm có N khác nhau để tạo hồi quy tuyến tính.";
    }
    drawCalibrationChart();
}

function drawCalibrationChart() {
    const canvas = $("calibrationChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 360;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const points = state.calibration;
    if (!points.length) {
        ctx.fillStyle = "#777"; ctx.font = "14px sans-serif"; ctx.fillText("Chưa có dữ liệu", 24, 34); return;
    }

    const pad = { l: 58, r: 28, t: 28, b: 50 };
    const ns = points.map(p => p.n); const des = points.map(p => p.delta_e);
    let minN = Math.min(...ns, 0), maxN = Math.max(...ns);
    let minDE = Math.min(...des, 0), maxDE = Math.max(...des);
    if (maxN === minN) maxN = minN + 1;
    if (maxDE === minDE) maxDE = minDE + 1;
    const x = v => pad.l + (v - minN) / (maxN - minN) * (width - pad.l - pad.r);
    const y = v => height - pad.b - (v - minDE) / (maxDE - minDE) * (height - pad.t - pad.b);

    ctx.strokeStyle = "#8f887b"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, height - pad.b); ctx.lineTo(width - pad.r, height - pad.b); ctx.stroke();
    ctx.fillStyle = "#625f59"; ctx.font = "12px sans-serif";
    ctx.fillText("Nồng độ N", width - 90, height - 14); ctx.fillText("ΔE", 18, 24);

    ctx.fillStyle = "#56633f";
    points.forEach(p => { ctx.beginPath(); ctx.arc(x(p.n), y(p.delta_e), 5, 0, Math.PI * 2); ctx.fill(); });

    if (state.model) {
        const m = state.model;
        ctx.strokeStyle = "#7c8b63"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x(minN), y(m.slope * minN + m.intercept)); ctx.lineTo(x(maxN), y(m.slope * maxN + m.intercept)); ctx.stroke();
    }
}

$("analyzeBtn").addEventListener("click", async () => {
    if (!(state.sampleFile && state.referenceFile && state.samplePoint && state.referencePoint)) return;
    const button = $("analyzeBtn");
    button.disabled = true; button.textContent = "Đang phân tích...";

    const form = new FormData();
    form.append("reference", state.referenceFile);
    form.append("sample", state.sampleFile);
    form.append("reference_x", state.referencePoint.xRatio);
    form.append("reference_y", state.referencePoint.yRatio);
    form.append("sample_x", state.samplePoint.xRatio);
    form.append("sample_y", state.samplePoint.yRatio);
    form.append("radius_ratio", Number($("roiRadius").value) / 100);

    try {
        const result = await apiFetch(`${API}/analyze`, { method: "POST", body: form });
        renderResult(result);
        saveHistory(result);
    } catch (error) {
        alert(`Không phân tích được: ${error.message}`);
    } finally {
        button.textContent = "Phân tích độ tươi";
        updateAnalyzeButton();
    }
});

function renderResult(result) {
    if (!result?.sample?.rgb || !result?.sample?.lab) {
        throw new Error("Backend trả về kết quả không đầy đủ.");
    }

    const rgb = result.sample.rgb;
    const lab = result.sample.lab;
    const deltaE = Number(result.deltaE);

    $("rgbResult").textContent =
        `(${Number(rgb.r).toFixed(1)}, ${Number(rgb.g).toFixed(1)}, ${Number(rgb.b).toFixed(1)})`;

    $("labResult").textContent =
        `L* ${Number(lab.L).toFixed(2)} · a* ${Number(lab.a).toFixed(2)} · b* ${Number(lab.b).toFixed(2)}`;

    $("deltaEResult").textContent =
        Number.isFinite(deltaE) ? deltaE.toFixed(3) : "—";

    const messageEl = $("resultMessage");
    messageEl.classList.remove("result-safe", "result-danger", "result-warning");

    if (result.estimated_n) {
        const nValue = Number(result.estimated_n.value);
        const threshold = Number(result.freshness?.threshold ?? 30);

        $("nResult").textContent =
            Number.isFinite(nValue) ? `${nValue.toFixed(3)} mg/100g` : "—";

        $("thresholdResult").textContent =
            `${threshold.toFixed(0)} mg/100g`;

        const withinRange =
            result.estimated_n.within_calibration_range === true;

        const rangeMessage = withinRange
            ? "Giá trị nằm trong khoảng của đường chuẩn."
            : "Cảnh báo: giá trị nằm ngoài khoảng đường chuẩn nên đây là phép ngoại suy.";

        if (result.freshness?.is_spoiled === true) {
            $("freshnessResult").textContent = "THỰC PHẨM HỎNG";
            messageEl.classList.add("result-danger");
        } else if (result.freshness?.is_spoiled === false) {
            $("freshnessResult").textContent = "CÒN SỬ DỤNG";
            messageEl.classList.add("result-safe");
        } else {
            $("freshnessResult").textContent = "CHƯA ĐÁNH GIÁ";
            messageEl.classList.add("result-warning");
        }

        messageEl.textContent =
            `${result.freshness?.message ?? "Đã suy ra nồng độ N."} ` +
            `N = ${nValue.toFixed(3)} mg/100g. ` +
            `Ngưỡng = ${threshold.toFixed(0)} mg/100g. ` +
            rangeMessage;
    } else {
        $("nResult").textContent = "Chưa có đường chuẩn";
        $("thresholdResult").textContent = "30 mg/100g";
        $("freshnessResult").textContent = "CHƯA ĐÁNH GIÁ";
        messageEl.classList.add("result-warning");
        messageEl.textContent =
            `Đã tính được ΔE = ${Number.isFinite(deltaE) ? deltaE.toFixed(3) : "—"}, ` +
            "nhưng chưa thể suy ra nồng độ N. Hãy tạo đường chuẩn trước.";
    }

    $("technicalResult").textContent = JSON.stringify(result, null, 2);
    $("resultSection").classList.remove("hidden");
}

function saveHistory(result) {
    const item = {
        date: new Date().toISOString(),
        sample: $("sampleName").value.trim() || "Mẫu không tên",
        rgb: result.sample.rgb,
        lab: result.sample.lab,
        reference_lab: result.reference.lab,
        deltaE: result.deltaE,
        N: result.estimated_n?.value ?? null,
        inRange: result.estimated_n?.within_calibration_range ?? null,
        threshold: result.freshness?.threshold ?? 30,
        freshnessStatus: result.freshness?.status ?? null,
    };
    state.history.unshift(item);
    state.history = state.history.slice(0, 200);
    localStorage.setItem("fresenHistory", JSON.stringify(state.history));
}

function renderHistory() {
    const container = $("historyList");
    if (!state.history.length) return container.innerHTML = `<p class="hint">Chưa có kết quả.</p>`;
    container.innerHTML = state.history.map(item => `
        <article class="history-item">
            <h3>${escapeHTML(item.sample)}</h3>
            <p><strong>Thời gian:</strong> ${new Date(item.date).toLocaleString()}</p>
            <p><strong>ΔE:</strong> ${format(item.deltaE, 3)} · <strong>N:</strong> ${item.N == null ? "N/A" : format(item.N, 3) + " mg/100g"}</p>
            <p><strong>Trạng thái:</strong> ${item.freshnessStatus === "spoiled" ? "THỰC PHẨM HỎNG" : item.freshnessStatus === "usable" ? "CÒN SỬ DỤNG" : "CHƯA ĐÁNH GIÁ"}</p>
            <p><strong>LAB:</strong> L* ${format(item.lab.L, 2)}, a* ${format(item.lab.a, 2)}, b* ${format(item.lab.b, 2)}</p>
        </article>`).join("");
}

$("clearHistory").addEventListener("click", () => {
    if (!confirm("Xóa toàn bộ lịch sử trên thiết bị này?")) return;
    state.history = []; localStorage.removeItem("fresenHistory"); renderHistory();
});

$("exportCSV").addEventListener("click", () => {
    if (!state.history.length) return alert("Chưa có lịch sử để xuất.");
    const rows = [["Date", "Sample", "R", "G", "B", "L", "a", "b", "DeltaE", "Estimated_N"]];
    state.history.forEach(i => rows.push([i.date, i.sample, i.rgb.r, i.rgb.g, i.rgb.b, i.lab.L, i.lab.a, i.lab.b, i.deltaE, i.N ?? ""]));
    const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "fresen_history.csv"; link.click(); URL.revokeObjectURL(url);
});

function format(value, digits) { return Number(value).toFixed(digits); }
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[ch]));
}

window.addEventListener("resize", () => {
    if (state.samplePoint) positionCrosshair($("sampleCrosshair"), $("preview"), state.samplePoint);
    if (state.referencePoint) positionCrosshair($("referenceCrosshair"), $("referencePreview"), state.referencePoint);
    if ($("calibration").classList.contains("active")) drawCalibrationChart();
});

(async function init() {
    showPage("home");
    renderHistory();
    await Promise.all([checkApi(), loadCalibration()]);
})();
