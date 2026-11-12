/* DermaScope Triage SPA entrypoint: registers view handlers and binds DOM events. */

import { PATHOLOGY_META, state } from "./config.js";
import {
    applyCompareCaseFilter,
    applyCompareZoom,
    compareZoom,
    loadCompareRecords,
    setCompareSlot,
    swapCompareSlots,
} from "./compare.js";
import {
    handleFileSelected,
    renderSampleGallery,
    runAnalysis,
    setAnatomicSiteUI,
} from "./console.js";
import {
    beginCaseEdit,
    deleteHistoryRecord,
    exportHistoryCSV,
    loadAnalyticsData,
    loadCases,
    renderHistoryTable,
} from "./history.js";
import { loadModelCard } from "./model-card.js";
import { downloadClinicalReport, renderResultsView } from "./results.js";
import {
    closeNavDrawer,
    navigate,
    openNavDrawer,
    registerViewHandler,
} from "./router.js";
import { toast } from "./utils.js";
import {
    resetCalibration,
    resetViewportTransform,
    setResultsHeatmapVisible,
    syncHeatmapCanvasToImage,
    syncResultsHeatmapCanvas,
    toggleGradCamHeatmap,
    updateCalibrationFilters,
    zoomIn,
    zoomOut,
} from "./viewport.js";

registerViewHandler("view-analytics", () => loadAnalyticsData());
registerViewHandler("view-compare", () => loadCompareRecords());
registerViewHandler("view-model", () => loadModelCard());
registerViewHandler("view-results", (payload) => {
    if (payload) renderResultsView(payload);
});

document.addEventListener("DOMContentLoaded", () => {
    // 1. Sidebar & inter-view router
    document.querySelectorAll("[data-view]").forEach(elem => {
        elem.addEventListener("click", (e) => {
            e.preventDefault();
            const viewId = elem.getAttribute("data-view");
            if (viewId) navigate(viewId);
        });
    });

    // 2. Mobile navigation drawer
    const btnNavOpen = document.getElementById("btn-nav-open");
    const btnNavClose = document.getElementById("btn-nav-close");
    const navBackdrop = document.getElementById("nav-backdrop");

    if (btnNavOpen) btnNavOpen.addEventListener("click", openNavDrawer);
    if (btnNavClose) btnNavClose.addEventListener("click", closeNavDrawer);
    if (navBackdrop) navBackdrop.addEventListener("click", closeNavDrawer);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeNavDrawer();
    });

    // 3. Grad-CAM canvas sizing & results toggle
    const btnResultsHeatmap = document.getElementById("btn-results-heatmap");
    if (btnResultsHeatmap) {
        btnResultsHeatmap.addEventListener("click", () => {
            if (!state.heatmapBase64) {
                toast("No Grad-CAM attribution is available for this scan.", "warning");
                return;
            }
            setResultsHeatmapVisible(!state.resultsHeatmapVisible);
        });
    }

    const resyncHeatmaps = () => {
        syncHeatmapCanvasToImage();
        syncResultsHeatmapCanvas();
    };
    window.addEventListener("resize", resyncHeatmaps);
    const viewportImgEl = document.getElementById("console-viewport-img");
    if (viewportImgEl) viewportImgEl.addEventListener("load", () => syncHeatmapCanvasToImage());

    // 4. Console sample gallery, cases, and anatomic site tags
    renderSampleGallery();
    loadCases();

    document.querySelectorAll(".anatomic-tag").forEach(tagBtn => {
        tagBtn.addEventListener("click", () => {
            state.selectedAnatomicSite = tagBtn.getAttribute("data-site");
            setAnatomicSiteUI(state.selectedAnatomicSite);
            toast(`Anatomic site: ${state.selectedAnatomicSite}`, "info");
        });
    });

    // 5. Viewport zoom, pan, heatmap toggle, and display calibration sliders
    const btnZoomIn = document.getElementById("btn-zoom-in");
    const btnZoomOut = document.getElementById("btn-zoom-out");
    const btnPanReset = document.getElementById("btn-pan-reset");
    const btnToggleHeatmap = document.getElementById("btn-toggle-heatmap");
    const bSlider = document.getElementById("slider-brightness");
    const cSlider = document.getElementById("slider-contrast");
    const sSlider = document.getElementById("slider-saturation");
    const btnResetCal = document.getElementById("btn-reset-calibration");

    if (btnZoomIn) btnZoomIn.addEventListener("click", zoomIn);
    if (btnZoomOut) btnZoomOut.addEventListener("click", zoomOut);
    if (btnPanReset) btnPanReset.addEventListener("click", resetViewportTransform);
    if (btnToggleHeatmap) btnToggleHeatmap.addEventListener("click", toggleGradCamHeatmap);
    if (bSlider) bSlider.addEventListener("input", (e) => { state.calibration.brightness = e.target.value; updateCalibrationFilters(); });
    if (cSlider) cSlider.addEventListener("input", (e) => { state.calibration.contrast = e.target.value; updateCalibrationFilters(); });
    if (sSlider) sSlider.addEventListener("input", (e) => { state.calibration.saturation = e.target.value; updateCalibrationFilters(); });
    if (btnResetCal) btnResetCal.addEventListener("click", resetCalibration);

    // 6. File upload & drag-drop
    const dropZone = document.getElementById("console-drop-zone");
    const fileInput = document.getElementById("console-file-input");

    if (dropZone && fileInput) {
        dropZone.addEventListener("click", () => fileInput.click());
        dropZone.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInput.click();
            }
        });
        fileInput.addEventListener("change", (e) => {
            if (e.target.files.length > 0) handleFileSelected(e.target.files[0]);
        });
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("ring-2", "ring-inset", "ring-primary", "bg-primary/5");
        });
        dropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            dropZone.classList.remove("ring-2", "ring-inset", "ring-primary", "bg-primary/5");
        });
        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("ring-2", "ring-inset", "ring-primary", "bg-primary/5");
            if (e.dataTransfer.files.length > 0) handleFileSelected(e.dataTransfer.files[0]);
        });
    }

    // 7. Run analysis & PDF report export
    const runBtn = document.getElementById("btn-run-analysis");
    if (runBtn) runBtn.addEventListener("click", runAnalysis);

    document.querySelectorAll(".btn-export-pdf-trigger").forEach(btn => {
        btn.addEventListener("click", downloadClinicalReport);
    });

    // 8. Knowledge hub category filter
    document.querySelectorAll(".kh-filter-btn").forEach(filterBtn => {
        filterBtn.addEventListener("click", () => {
            const cat = filterBtn.getAttribute("data-cat");

            document.querySelectorAll(".kh-filter-btn").forEach(b => {
                const isActive = b === filterBtn;
                b.classList.toggle("is-active", isActive);
                b.setAttribute("aria-pressed", isActive ? "true" : "false");
            });

            document.querySelectorAll("#knowledge-cards-container .kh-card").forEach(card => {
                const cardCat = card.getAttribute("data-category");
                card.classList.toggle("hidden", !(cat === "all" || cardCat === cat));
            });
        });
    });

    // 9. History search, CSV export, inline case edit, and delegated delete
    const historySearchInput = document.getElementById("history-search-input");
    if (historySearchInput) {
        historySearchInput.addEventListener("input", (e) => {
            const q = e.target.value.toLowerCase().trim();
            if (!q) {
                renderHistoryTable(state.history);
                return;
            }
            const filtered = state.history.filter(item => {
                const meta = PATHOLOGY_META[item.prediction] || { name: item.prediction };
                return item.id.toString().includes(q) ||
                       item.prediction.toLowerCase().includes(q) ||
                       meta.name.toLowerCase().includes(q) ||
                       (item.case_label || "").toLowerCase().includes(q);
            });
            renderHistoryTable(filtered);
        });
    }

    const btnExportCSV = document.getElementById("btn-export-csv");
    if (btnExportCSV) btnExportCSV.addEventListener("click", exportHistoryCSV);

    const historyBody = document.getElementById("analytics-history-tbody");
    if (historyBody) {
        historyBody.addEventListener("click", (e) => {
            const deleteBtn = e.target.closest(".history-delete-btn");
            if (deleteBtn) {
                const id = deleteBtn.getAttribute("data-delete-id");
                if (id) deleteHistoryRecord(id);
                return;
            }
            const editBtn = e.target.closest(".case-edit-btn");
            if (!editBtn) return;
            const cell = editBtn.closest(".case-cell");
            if (!cell) return;
            const id = cell.getAttribute("data-session-id");
            const record = (state.history || []).find(r => String(r.id) === String(id));
            beginCaseEdit(cell, id, record ? record.case_label : "");
        });
    }

    // 10. Model card refresh
    const btnModelRefresh = document.getElementById("btn-model-refresh");
    if (btnModelRefresh) btnModelRefresh.addEventListener("click", loadModelCard);

    // 11. Compare view controls & wheel zoom
    const caseFilter = document.getElementById("compare-case-filter");
    if (caseFilter) {
        caseFilter.addEventListener("change", (e) => applyCompareCaseFilter(e.target.value));
    }

    const btnCompareRefresh = document.getElementById("btn-compare-refresh");
    const btnCompareSwap = document.getElementById("btn-compare-swap");
    const selectA = document.getElementById("compare-select-a");
    const selectB = document.getElementById("compare-select-b");

    if (selectA) selectA.addEventListener("change", (e) => setCompareSlot("A", e.target.value));
    if (selectB) selectB.addEventListener("change", (e) => setCompareSlot("B", e.target.value));
    if (btnCompareSwap) btnCompareSwap.addEventListener("click", swapCompareSlots);
    if (btnCompareRefresh) btnCompareRefresh.addEventListener("click", () => loadCompareRecords(true));

    const syncToggle = document.getElementById("syncToggle");
    const syncThumb = document.getElementById("syncThumb");
    if (syncToggle && syncThumb) {
        syncToggle.addEventListener("click", () => {
            compareZoom.linked = !compareZoom.linked;
            if (compareZoom.linked) {
                syncThumb.style.transform = "translateX(0)";
                syncToggle.className = "w-9 h-5 rounded-full relative transition-colors duration-200 bg-primary/50 border border-primary/60";
                syncToggle.setAttribute("aria-checked", "true");
                compareZoom.b = compareZoom.a;
                applyCompareZoom();
                toast("Zoom linked", "info");
            } else {
                syncThumb.style.transform = "translateX(-16px)";
                syncToggle.className = "w-9 h-5 rounded-full relative transition-colors duration-200 bg-surface-container-high border border-outline";
                syncToggle.setAttribute("aria-checked", "false");
                toast("Zoom unlinked", "info");
            }
        });
    }

    const vLeft = document.getElementById("viewportLeft");
    const vRight = document.getElementById("viewportRight");

    function wheelZoom(slot) {
        return (e) => {
            e.preventDefault();
            const step = e.deltaY < 0 ? 0.1 : -0.1;
            const clamp = (v) => Math.max(1.0, Math.min(4.0, v + step));
            if (compareZoom.linked) {
                compareZoom.a = clamp(compareZoom.a);
                compareZoom.b = compareZoom.a;
            } else if (slot === "A") {
                compareZoom.a = clamp(compareZoom.a);
            } else {
                compareZoom.b = clamp(compareZoom.b);
            }
            applyCompareZoom();
        };
    }

    if (vLeft) vLeft.addEventListener("wheel", wheelZoom("A"), { passive: false });
    if (vRight) vRight.addEventListener("wheel", wheelZoom("B"), { passive: false });

    const btnResultsCompare = document.getElementById("btn-results-compare");
    if (btnResultsCompare) {
        btnResultsCompare.addEventListener("click", () => {
            const id = state.latestResult && state.latestResult.session_id;
            if (id) state.compare.pendingA = String(id);
        }, true);
    }

    navigate("view-console");
});
