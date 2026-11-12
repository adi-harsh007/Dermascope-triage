/* Scan console: upload handling, sample gallery, site tagger, and inference trigger. */

import { ANATOMIC_SITES, CLINICAL_SAMPLES, HAM_SITE_TO_API_SITE, state } from "./config.js";
import { loadCases } from "./history.js";
import { navigate } from "./router.js";
import { apiCall, toast } from "./utils.js";
import { renderGradCamHeatmap, resetCalibration } from "./viewport.js";

export function setAnatomicSiteUI(site) {
    document.querySelectorAll(".anatomic-tag").forEach(b => {
        const isActive = b.getAttribute("data-site") === site;
        b.classList.toggle("is-active", isActive);
        b.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
}

function setAnalyzeButtonIdle(btn) {
    if (!btn) return;
    btn.classList.remove("is-busy");
    btn.innerHTML = `<span class="material-symbols-outlined">play_arrow</span> Run analysis`;
}

function setAnalysisOverlay(visible) {
    const overlay = document.getElementById("analysis-overlay");
    if (!overlay) return;
    overlay.classList.toggle("hidden", !visible);
    overlay.classList.toggle("flex", visible);
}

export function setConsoleViewportImage(src) {
    const viewportPlaceholder = document.getElementById("console-viewport-placeholder");
    const viewportImg = document.getElementById("console-viewport-img");
    const analyzeBtn = document.getElementById("btn-run-analysis");

    if (viewportImg && viewportPlaceholder) {
        viewportImg.src = src;
        viewportImg.classList.remove("hidden");
        viewportPlaceholder.classList.add("hidden");
    }

    if (analyzeBtn) {
        analyzeBtn.disabled = false;
        setAnalyzeButtonIdle(analyzeBtn);
    }

    resetCalibration();
}

export function handleFileSelected(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
        toast("Please upload a valid image file (JPEG, PNG, WEBP).", "error");
        return;
    }

    state.selectedFile = file;

    const statusTag = document.getElementById("image-status-tag");
    if (statusTag) statusTag.textContent = `Uploaded · ${file.name}`;

    const reader = new FileReader();
    reader.onload = (e) => {
        setConsoleViewportImage(e.target.result);
    };
    reader.readAsDataURL(file);
}

export function toApiSite(localization) {
    if (!localization) return null;
    if (ANATOMIC_SITES.includes(localization)) return localization;
    return HAM_SITE_TO_API_SITE[localization] || null;
}

export function loadSampleImage(sampleInput) {
    let sample = sampleInput;
    if (typeof sampleInput === "string") {
        sample = CLINICAL_SAMPLES.find(s => s.id === sampleInput || s.url === sampleInput) || {
            name: "Clinical Case",
            site: "Anterior Torso",
            url: sampleInput,
        };
    }

    state.selectedFile = null;
    setConsoleViewportImage(sample.url);

    const apiSite = toApiSite(sample.site);
    if (apiSite) {
        state.selectedAnatomicSite = apiSite;
        setAnatomicSiteUI(apiSite);
    }

    const statusTag = document.getElementById("image-status-tag");
    if (statusTag) statusTag.textContent = `Sample · ${sample.name || "Case"}`;

    toast(`Loaded sample: ${sample.name || "Case"}`, "info");
}

export function renderSampleGallery() {
    const container = document.getElementById("sample-gallery-list");
    if (!container) return;

    container.innerHTML = CLINICAL_SAMPLES.map(s => {
        const chipClass = s.category === "Malignant" ? "chip chip--high"
            : s.category === "Pre-Malignant" ? "chip chip--mid"
            : s.category === "Benign" ? "chip chip--low"
            : "chip";
        return `
            <button type="button" data-sample-id="${s.id}"
                    class="sample-card w-full text-left p-2.5 rounded-lg bg-surface-container border border-outline-variant hover:border-outline hover:bg-surface-container-high cursor-pointer transition-colors flex items-center gap-3">
                <img src="${s.url}" class="w-11 h-11 rounded-md object-cover bg-surface-dim shrink-0" alt="" />
                <span class="min-w-0 flex-1">
                    <span class="block text-[13px] font-medium text-on-surface truncate">${s.name}</span>
                    <span class="block text-[12px] text-on-surface-muted truncate mt-0.5">${s.site}</span>
                </span>
                <span class="${chipClass} shrink-0">${s.category}</span>
            </button>
        `;
    }).join("");

    container.querySelectorAll(".sample-card").forEach(card => {
        card.addEventListener("click", () => {
            const sampleId = card.getAttribute("data-sample-id");
            const sample = CLINICAL_SAMPLES.find(s => s.id === sampleId);
            if (sample) loadSampleImage(sample);
        });
    });
}

export async function runAnalysis() {
    const analyzeBtn = document.getElementById("btn-run-analysis");
    if (!analyzeBtn || analyzeBtn.disabled) return;

    const viewportImg = document.getElementById("console-viewport-img");
    if (!state.selectedFile && (!viewportImg || !viewportImg.src)) {
        toast("Please upload or select an image scan first.", "warning");
        return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.classList.add("is-busy");
    analyzeBtn.innerHTML = `<span class="material-symbols-outlined animate-spin">progress_activity</span> Analysing…`;
    setAnalysisOverlay(true);

    try {
        const formData = new FormData();

        if (state.selectedFile) {
            formData.append("file", state.selectedFile);
        } else {
            const res = await fetch(viewportImg.src);
            if (!res.ok) {
                throw new Error("Could not load the selected image. Please re-select or upload it.");
            }
            const blob = await res.blob();
            formData.append("file", blob, "lesion_scan.jpg");
        }

        formData.append("site", state.selectedAnatomicSite);

        const caseInput = document.getElementById("input-case-label");
        if (caseInput && caseInput.value.trim()) {
            formData.append("case", caseInput.value.trim());
        }

        const result = await apiCall("/analyze", {
            method: "POST",
            body: formData,
        });

        result._previewUrl = viewportImg ? viewportImg.src : "";

        if (result.heatmap_base64) {
            state.heatmapBase64 = result.heatmap_base64;
            renderGradCamHeatmap(state.heatmapBase64);
            toast("Diagnostic inference & Grad-CAM map generated!", "success");
        } else {
            state.heatmapBase64 = null;
            toast("Inference complete. Grad-CAM attribution unavailable for this scan.", "warning");
        }

        state.latestResult = result;
        if (result.case_label) loadCases(true);

        navigate("view-results", result);
    } catch (err) {
        toast(err.message, "error");
    } finally {
        analyzeBtn.disabled = false;
        setAnalyzeButtonIdle(analyzeBtn);
        setAnalysisOverlay(false);
    }
}

