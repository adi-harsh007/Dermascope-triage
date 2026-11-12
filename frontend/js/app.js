/* DermaScope Triage SPA entrypoint: live status sync, view handlers, and DOM bindings. */

import { PATHOLOGY_META, state } from "./config.js";
import {
    applyCompareCaseFilter,
    applyCompareZoom,
    compareZoom,
    loadCompareRecords,
    resetCompareZoom,
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
    getViewFromHash,
    navigate,
    openNavDrawer,
    registerViewHandler,
    syncNavIndicator,
} from "./router.js";
import { apiCall, toast } from "./utils.js";
import {
    initViewportGestures,
    resetCalibration,
    resetViewportTransform,
    setResultsHeatmapVisible,
    syncHeatmapCanvasToImage,
    syncResultsHeatmapCanvas,
    toggleGradCamHeatmap,
    updateCalibrationFilters,
    wasViewportDragged,
    zoomIn,
    zoomOut,
} from "./viewport.js";

async function refreshServiceStatus() {
    const dot = document.getElementById("sidebar-status-dot");
    const title = document.getElementById("sidebar-status-title");
    const sub = document.getElementById("sidebar-status-sub");
    const chip = document.getElementById("topbar-status-chip");
    const chipDot = document.getElementById("topbar-status-dot");
    const chipText = document.getElementById("topbar-status-text");

    try {
        const health = await apiCall("/health");
        const model = health.model || {};
        const present = Boolean(model.checkpoint_present);
        const loaded = Boolean(model.loaded);
        const degraded = health.degraded || [];

        if (dot) {
            dot.className = "w-2 h-2 rounded-full shrink-0 " +
                (!present ? "bg-risk-high" : loaded ? "bg-risk-low" : "bg-risk-mid");
        }
        if (title) {
            title.textContent = !present
                ? "Checkpoint missing"
                : loaded ? "EfficientNet-B3 active" : "Ready (lazy load)";
        }
        if (sub) {
            sub.textContent = `${model.input_size || 300}px · 7 classes · HAM10000`;
        }
        if (chip && chipDot && chipText) {
            const hasHardBlock = !present;
            chip.className = "chip " + (hasHardBlock ? "chip--high" : degraded.length ? "chip--mid" : "chip--low");
            chipDot.className = "w-1.5 h-1.5 rounded-full " +
                (hasHardBlock ? "bg-risk-high" : degraded.length ? "bg-risk-mid" : "bg-risk-low");
            chipText.textContent = !present
                ? "Checkpoint missing"
                : loaded ? "Model active" : "Service online";
        }
    } catch (_) {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-risk-high shrink-0";
        if (title) title.textContent = "Server unreachable";
        if (chip && chipDot && chipText) {
            chip.className = "chip chip--high";
            chipDot.className = "w-1.5 h-1.5 rounded-full bg-risk-high";
            chipText.textContent = "Offline";
        }
    }
}

registerViewHandler("view-analytics", () => loadAnalyticsData());
registerViewHandler("view-compare", () => loadCompareRecords());
registerViewHandler("view-model", () => loadModelCard());
registerViewHandler("view-results", (payload) => {
    if (payload) renderResultsView(payload);
});

document.addEventListener("DOMContentLoaded", () => {
    // 1. Sidebar & inter-view navigation
    document.querySelectorAll("[data-view]").forEach(elem => {
        elem.addEventListener("click", (e) => {
            e.preventDefault();
            const viewId = elem.getAttribute("data-view");
            if (viewId) navigate(viewId);
        });
    });

    window.addEventListener("popstate", () => {
        const viewId = getViewFromHash() || "view-console";
        navigate(viewId, null, { updateHash: false });
    });

    // 2. Mobile navigation drawer
    const btnNavOpen = document.getElementById("btn-nav-open");
    const btnNavClose = document.getElementById("btn-nav-close");
    const navBackdrop = document.getElementById("nav-backdrop");

    if (btnNavOpen) btnNavOpen.addEventListener("click", openNavDrawer);
    if (btnNavClose) btnNavClose.addEventListener("click", closeNavDrawer);
    if (navBackdrop) navBackdrop.addEventListener("click", closeNavDrawer);

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

    const resyncLayout = () => {
        syncHeatmapCanvasToImage();
        syncResultsHeatmapCanvas();
        const active = document.querySelector(".nav-item.is-active");
        if (active) syncNavIndicator(active);
    };
    window.addEventListener("resize", resyncLayout);
    const viewportImgEl = document.getElementById("console-viewport-img");
    if (viewportImgEl) viewportImgEl.addEventListener("load", () => syncHeatmapCanvasToImage());

    // 4. Console sample gallery, cases, anatomic site tags, and live health
    renderSampleGallery();
    loadCases();
    refreshServiceStatus();

    document.querySelectorAll(".anatomic-tag").forEach(tagBtn => {
        tagBtn.addEventListener("click", () => {
            state.selectedAnatomicSite = tagBtn.getAttribute("data-site");
            setAnatomicSiteUI(state.selectedAnatomicSite);
            toast(`Anatomic site: ${state.selectedAnatomicSite}`, "info");
        });
    });

    // 5. Floating viewport dock: zoom, pan, heatmap, and display adjustment popover
    initViewportGestures();

    const btnZoomIn = document.getElementById("btn-zoom-in");
    const btnZoomOut = document.getElementById("btn-zoom-out");
    const btnPanReset = document.getElementById("btn-pan-reset");
    const btnToggleHeatmap = document.getElementById("btn-toggle-heatmap");
    const btnAdjustToggle = document.getElementById("btn-adjust-toggle");
    const adjustPopover = document.getElementById("adjust-popover");
    const bSlider = document.getElementById("slider-brightness");
    const cSlider = document.getElementById("slider-contrast");
    const sSlider = document.getElementById("slider-saturation");
    const btnResetCal = document.getElementById("btn-reset-calibration");
    const btnResetAdjustInline = document.getElementById("btn-reset-adjust-inline");

    const setAdjustOpen = (open) => {
        if (!adjustPopover || !btnAdjustToggle) return;
        adjustPopover.classList.toggle("hidden", !open);
        btnAdjustToggle.classList.toggle("is-on", open);
        btnAdjustToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };

    if (btnZoomIn) btnZoomIn.addEventListener("click", () => zoomIn(true));
    if (btnZoomOut) btnZoomOut.addEventListener("click", () => zoomOut(true));
    if (btnPanReset) btnPanReset.addEventListener("click", () => resetViewportTransform());
    if (btnToggleHeatmap) btnToggleHeatmap.addEventListener("click", toggleGradCamHeatmap);
    if (btnAdjustToggle && adjustPopover) {
        btnAdjustToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            setAdjustOpen(adjustPopover.classList.contains("hidden"));
        });
    }
    if (bSlider) bSlider.addEventListener("input", (e) => { state.calibration.brightness = e.target.value; updateCalibrationFilters(); });
    if (cSlider) cSlider.addEventListener("input", (e) => { state.calibration.contrast = e.target.value; updateCalibrationFilters(); });
    if (sSlider) sSlider.addEventListener("input", (e) => { state.calibration.saturation = e.target.value; updateCalibrationFilters(); });
    if (btnResetCal) btnResetCal.addEventListener("click", () => resetCalibration());
    if (btnResetAdjustInline) btnResetAdjustInline.addEventListener("click", () => resetCalibration());

    document.addEventListener("click", (e) => {
        if (adjustPopover && !adjustPopover.classList.contains("hidden")
                && !e.target.closest("#adjust-popover, #btn-adjust-toggle")) {
            setAdjustOpen(false);
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeNavDrawer();
            setAdjustOpen(false);
        }
    });

    // 6. File upload & drag-drop (ignores clicks inside dock/popover or after drag-pan)
    const dropZone = document.getElementById("console-drop-zone");
    const fileInput = document.getElementById("console-file-input");
    const btnReplaceImage = document.getElementById("btn-replace-image");

    if (btnReplaceImage && fileInput) {
        btnReplaceImage.addEventListener("click", (e) => {
            e.stopPropagation();
            fileInput.click();
        });
    }

    if (dropZone && fileInput) {
        dropZone.addEventListener("click", (e) => {
            if (e.target.closest(".viewport-dock, .adjust-popover, #btn-replace-image")) return;
            if (wasViewportDragged() || state.zoom > 1.0) return;
            fileInput.click();
        });
        dropZone.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                if (e.target.closest(".viewport-dock, .adjust-popover")) return;
                e.preventDefault();
                fileInput.click();
            }
        });
        fileInput.addEventListener("change", (e) => {
            if (e.target.files.length > 0) handleFileSelected(e.target.files[0]);
        });
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("ring-2", "ring-inset", "ring-primary/60");
        });
        dropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            dropZone.classList.remove("ring-2", "ring-inset", "ring-primary/60");
        });
        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("ring-2", "ring-inset", "ring-primary/60");
            if (e.dataTransfer.files.length > 0) handleFileSelected(e.dataTransfer.files[0]);
        });
    }

    // 7. Run analysis & PDF report export
    const runBtn = document.getElementById("btn-run-analysis");
    if (runBtn) runBtn.addEventListener("click", () => runAnalysis(refreshServiceStatus));

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

    // 9. History search, CSV export, inline case edit, compare shortcut, and delete
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
            const compareBtn = e.target.closest(".history-compare-btn");
            if (compareBtn) {
                const id = compareBtn.getAttribute("data-compare-id");
                if (id) {
                    state.compare.pendingA = String(id);
                    navigate("view-compare");
                }
                return;
            }
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
    const btnCompareZoomReset = document.getElementById("btn-compare-zoom-reset");
    const selectA = document.getElementById("compare-select-a");
    const selectB = document.getElementById("compare-select-b");

    if (selectA) selectA.addEventListener("change", (e) => setCompareSlot("A", e.target.value));
    if (selectB) selectB.addEventListener("change", (e) => setCompareSlot("B", e.target.value));
    if (btnCompareSwap) btnCompareSwap.addEventListener("click", swapCompareSlots);
    if (btnCompareRefresh) btnCompareRefresh.addEventListener("click", () => loadCompareRecords(true));
    if (btnCompareZoomReset) btnCompareZoomReset.addEventListener("click", resetCompareZoom);

    const syncToggle = document.getElementById("syncToggle");
    const syncThumb = document.getElementById("syncThumb");
    if (syncToggle && syncThumb) {
        syncToggle.addEventListener("click", () => {
            compareZoom.linked = !compareZoom.linked;
            if (compareZoom.linked) {
                syncThumb.style.transform = "translateX(0)";
                syncToggle.className = "w-9 h-5 rounded-full relative transition-colors duration-200 bg-on-surface border border-on-surface/50";
                syncThumb.className = "w-3.5 h-3.5 bg-on-primary rounded-full absolute right-[2px] top-[2px] transition-transform duration-200";
                syncToggle.setAttribute("aria-checked", "true");
                compareZoom.b = compareZoom.a;
                applyCompareZoom();
                toast("Zoom linked", "info");
            } else {
                syncThumb.style.transform = "translateX(-16px)";
                syncToggle.className = "w-9 h-5 rounded-full relative transition-colors duration-200 bg-surface-container-highest border border-outline";
                syncThumb.className = "w-3.5 h-3.5 bg-on-surface-variant rounded-full absolute right-[2px] top-[2px] transition-transform duration-200";
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
            const step = e.deltaY < 0 ? 0.12 : -0.12;
            const clamp = (v) => Math.max(1.0, Math.min(4.0, Number((v + step).toFixed(2))));
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

    // 12. Initial route from hash (avoid jumping straight to empty #result on refresh)
    const initialHashView = getViewFromHash();
    const startView = (initialHashView && initialHashView !== "view-results")
        ? initialHashView
        : "view-console";
    navigate(startView, null, { updateHash: false });
});
