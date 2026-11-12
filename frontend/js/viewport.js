/* Console viewport zoom/pan, CSS display filters, and Grad-CAM canvas overlay. */

import { IMG_INPUT_SIZE, state } from "./config.js";
import { toast } from "./utils.js";

export function updateViewportTransform() {
    const img = document.getElementById("console-viewport-img");
    const canvas = document.getElementById("console-heatmap-canvas");

    if (img) {
        img.style.transform = `scale(${state.zoom}) translate(${state.panX}px, ${state.panY}px)`;
        img.style.transition = "transform 0.15s ease-out";
    }
    if (canvas) {
        canvas.style.transform = `scale(${state.zoom}) translate(${state.panX}px, ${state.panY}px)`;
        canvas.style.transition = "transform 0.15s ease-out";
    }

    const resTag = document.getElementById("image-resolution-tag");
    if (resTag) {
        const dim = Math.round(IMG_INPUT_SIZE * state.zoom);
        resTag.textContent = `${dim} x ${dim} px (${Math.round(state.zoom * 100)}%)`;
    }
}

export function zoomIn() {
    state.zoom = Math.min(state.zoom + 0.25, 3.0);
    updateViewportTransform();
    toast(`Viewport Zoom: ${Math.round(state.zoom * 100)}%`, "info");
}

export function zoomOut() {
    state.zoom = Math.max(state.zoom - 0.25, 0.5);
    updateViewportTransform();
    toast(`Viewport Zoom: ${Math.round(state.zoom * 100)}%`, "info");
}

export function resetViewportTransform() {
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    updateViewportTransform();
    toast("Viewport Zoom & Pan Reset", "info");
}

export function syncHeatmapCanvasToImage(
    containerId = "preview-container",
    imgId = "console-viewport-img",
    canvasId = "console-heatmap-canvas"
) {
    const container = document.getElementById(containerId);
    const img = document.getElementById(imgId);
    const canvas = document.getElementById(canvasId);
    if (!container || !img || !canvas) return;
    if (!img.naturalWidth || !img.naturalHeight) return;

    const box = img.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    if (!box.width || !box.height) return;

    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const drawnW = img.naturalWidth * scale;
    const drawnH = img.naturalHeight * scale;

    canvas.style.left = `${(box.left - containerBox.left) + (box.width - drawnW) / 2}px`;
    canvas.style.top = `${(box.top - containerBox.top) + (box.height - drawnH) / 2}px`;
    canvas.style.width = `${drawnW}px`;
    canvas.style.height = `${drawnH}px`;
    canvas.style.maxWidth = "none";
    canvas.style.maxHeight = "none";
}

export function renderGradCamHeatmap(base64Data) {
    const canvas = document.getElementById("console-heatmap-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!base64Data) return;

    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        syncHeatmapCanvasToImage();
    };
    img.src = base64Data;
}

export function syncResultsHeatmapCanvas() {
    syncHeatmapCanvasToImage("results-image-wrap", "results-image", "results-heatmap-canvas");
}

export function drawResultsHeatmap() {
    const canvas = document.getElementById("results-heatmap-canvas");
    if (!canvas || !state.heatmapBase64) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        syncResultsHeatmapCanvas();
    };
    img.src = state.heatmapBase64;
}

export function setResultsHeatmapVisible(visible) {
    const canvas = document.getElementById("results-heatmap-canvas");
    const btn = document.getElementById("btn-results-heatmap");
    state.resultsHeatmapVisible = visible;
    if (canvas) canvas.classList.toggle("hidden", !visible);
    if (btn) {
        btn.classList.toggle("is-on", visible);
        btn.setAttribute("aria-pressed", visible ? "true" : "false");
    }
    if (visible) drawResultsHeatmap();
}

export function toggleGradCamHeatmap() {
    if (!state.heatmapBase64) {
        toast("No Grad-CAM attribution is available for this scan.", "warning");
        return;
    }
    state.heatmapVisible = !state.heatmapVisible;
    const canvas = document.getElementById("console-heatmap-canvas");
    const toggleBtn = document.getElementById("btn-toggle-heatmap");

    if (!canvas) return;

    if (state.heatmapVisible) {
        renderGradCamHeatmap(state.heatmapBase64);
        canvas.classList.remove("hidden");
        syncHeatmapCanvasToImage();
        if (toggleBtn) {
            toggleBtn.classList.add("is-on");
            toggleBtn.setAttribute("aria-pressed", "true");
        }
        toast("Grad-CAM overlay on", "info");
    } else {
        canvas.classList.add("hidden");
        if (toggleBtn) {
            toggleBtn.classList.remove("is-on");
            toggleBtn.setAttribute("aria-pressed", "false");
        }
        toast("Grad-CAM overlay off", "info");
    }
}

export function updateCalibrationFilters() {
    const img = document.getElementById("console-viewport-img");
    if (!img) return;

    const { brightness, contrast, saturation } = state.calibration;
    img.style.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;

    const bVal = document.getElementById("val-brightness");
    const cVal = document.getElementById("val-contrast");
    const sVal = document.getElementById("val-saturation");

    if (bVal) bVal.textContent = `${brightness}%`;
    if (cVal) cVal.textContent = `${contrast}%`;
    if (sVal) sVal.textContent = `${saturation}%`;
}

export function resetCalibration() {
    state.calibration = { brightness: 100, contrast: 100, saturation: 100 };
    const bSlider = document.getElementById("slider-brightness");
    const cSlider = document.getElementById("slider-contrast");
    const sSlider = document.getElementById("slider-saturation");

    if (bSlider) bSlider.value = 100;
    if (cSlider) cSlider.value = 100;
    if (sSlider) sSlider.value = 100;

    updateCalibrationFilters();
    resetViewportTransform();
    toast("Image calibration parameters & viewport reset to baseline defaults", "success");
}

