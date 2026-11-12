/* Diagnostic results view, OOD gate readout, clinical summary, and PDF/print report. */

import { API_BASE, IMG_INPUT_SIZE, PATHOLOGY_META, state } from "./config.js";
import { escapeHtml, formatMs, toast } from "./utils.js";
import { setResultsHeatmapVisible, syncResultsHeatmapCanvas } from "./viewport.js";

function renderResultsImage(data) {
    const img = document.getElementById("results-image");
    const missing = document.getElementById("results-image-missing");
    const btn = document.getElementById("btn-results-heatmap");
    const note = document.getElementById("results-image-note");
    if (!img || !missing) return;

    setResultsHeatmapVisible(false);

    if (btn) {
        const available = Boolean(state.heatmapBase64);
        btn.disabled = !available;
        btn.title = available
            ? "Overlay the model's Grad-CAM attribution map"
            : "No Grad-CAM attribution was returned for this scan";
    }
    if (note) {
        note.textContent = state.heatmapBase64
            ? "As submitted. Console display adjustments are not applied here."
            : "As submitted. No Grad-CAM attribution was returned for this scan.";
    }

    const showMissing = () => {
        img.classList.add("hidden");
        missing.classList.remove("hidden");
        missing.classList.add("flex");
    };

    if (!data.session_id) {
        showMissing();
        return;
    }

    img.onerror = showMissing;
    img.onload = () => {
        missing.classList.add("hidden");
        missing.classList.remove("flex");
        img.classList.remove("hidden");
        syncResultsHeatmapCanvas();
    };
    img.src = `${API_BASE}/history/${encodeURIComponent(data.session_id)}/image`;
}

export function buildClinicalSummary(data, meta) {
    const pct = (data.confidence * 100).toFixed(1);
    const name = meta.name;
    const parts = [];

    if (data.is_high_risk) {
        parts.push(
            `The model's leading classification is ${name} at ${pct}% confidence, ` +
            "which falls in the group flagged as high risk (melanoma, basal cell carcinoma, " +
            "actinic keratosis). Specialist dermatological assessment is indicated."
        );
    } else {
        parts.push(
            `The model's leading classification is ${name} at ${pct}% confidence, ` +
            "a class not flagged as high risk."
        );
    }

    if (data.melanoma_alert) {
        const mp = data.melanoma_probability != null
            ? ` (p(mel) ${(data.melanoma_probability * 100).toFixed(1)}%)`
            : "";
        parts.push(
            `The independent melanoma alert channel fired for this scan${mp}: melanoma is ` +
            "not excluded regardless of the leading class, and the scan is flagged for review."
        );
    }

    const recall = data.operating_point && data.operating_point.melanoma_recall;
    if (typeof recall === "number" && recall >= 0 && recall <= 1) {
        const missedInEvery = Math.round(1 / (1 - recall));
        const showGloss = recall < 0.995 && isFinite(missedInEvery) && missedInEvery >= 2;
        parts.push(
            `The melanoma recall recorded for this configuration is ${recall.toFixed(3)}` +
            (showGloss
                ? ` — roughly one melanoma in ${missedInEvery} is missed by the prediction itself.`
                : ".")
        );
    }

    parts.push("A result that is not flagged is not a clinical clearance.");
    return parts.join(" ");
}

function renderOodPanel(data) {
    const badge = document.getElementById("ood-status-badge");
    const statusText = document.getElementById("ood-status-text");
    const note = document.getElementById("ood-calibration-note");
    const cells = {
        "ood-rel-contrast": "rel_contrast",
        "ood-hf-ratio": "hf_ratio",
        "ood-blue-green": "blue_green",
    };

    const m = data.ood_metrics;
    for (const [elId, key] of Object.entries(cells)) {
        const el = document.getElementById(elId);
        if (!el) continue;
        el.textContent = (m && typeof m[key] === "number") ? m[key].toFixed(3) : "—";
    }

    if (badge) {
        badge.textContent = m ? "Stage 1 passed" : "Not reported";
        badge.className = "chip " + (m ? "chip--low" : "");
    }
    if (statusText) {
        statusText.textContent = m
            ? "Image statistics fell inside the accepted range, so the colour gate did not reject this scan. " +
              "The colour gate rejects flat fields, pixel noise and non-skin hues; it cannot reject a " +
              "photograph of another real object."
            : "The server did not report out-of-distribution metrics for this scan.";
    }
    if (note) {
        const bits = [];
        bits.push(data.ood_calibrated
            ? "Gate thresholds: fitted to data."
            : "Gate thresholds: provisional defaults, not yet fitted (scripts/calibrate_ood.py).");
        bits.push(data.ood_feature_stage_active
            ? "Feature-space stage: active."
            : "Feature-space stage: not fitted, did not run.");
        note.textContent = bits.join(" ");
        note.className = "text-[12px] leading-5 " +
            ((data.ood_calibrated && data.ood_feature_stage_active)
                ? "text-on-surface-muted"
                : "text-risk-mid");
    }
}

export function renderResultsView(data) {
    if (!data) return;

    const empty = document.getElementById("results-empty");
    const body = document.getElementById("results-content");
    if (empty) empty.classList.add("hidden");
    if (body) body.classList.remove("hidden");

    const isHighRisk = data.is_high_risk;
    const confidencePct = (data.confidence * 100).toFixed(1);
    const meta = PATHOLOGY_META[data.prediction] || {
        name: data.prediction.toUpperCase(),
        code: "ICD-11: N/A",
        type: isHighRisk ? "High Risk" : "Low Risk",
        desc: "Dermoscopic diagnostic result computed by EfficientNet-B3 neural network.",
    };

    const banner = document.getElementById("results-alert-banner");
    const bannerIcon = document.getElementById("results-alert-icon");
    const bannerText = document.getElementById("results-alert-text");

    if (banner && bannerIcon && bannerText) {
        const bannerBase = "px-4 py-3 rounded-xl border flex items-center gap-3";
        const iconBase = "material-symbols-outlined text-[20px] shrink-0";
        const textBase = "text-[13px] font-medium leading-5";

        if (!isHighRisk && data.melanoma_alert) {
            banner.className = `${bannerBase} border-risk-mid/35 bg-risk-mid/10`;
            bannerIcon.className = `${iconBase} text-risk-mid`;
            bannerIcon.textContent = "release_alert";
            bannerText.className = `${textBase} text-risk-mid`;
            bannerText.textContent =
                `Melanoma not excluded — p(mel) ${(data.melanoma_probability * 100).toFixed(1)}%. Specialist review recommended.`;
        } else if (isHighRisk) {
            banner.className = `${bannerBase} border-risk-high/35 bg-risk-high/10`;
            bannerIcon.className = `${iconBase} text-risk-high`;
            bannerIcon.textContent = "warning";
            bannerText.className = `${textBase} text-risk-high`;
            bannerText.textContent = "Predicted class is in the high-risk group. Specialist assessment is indicated.";
        } else {
            banner.className = `${bannerBase} border-risk-low/35 bg-risk-low/10`;
            bannerIcon.className = `${iconBase} text-risk-low`;
            bannerIcon.textContent = "check_circle";
            bannerText.className = `${textBase} text-risk-low`;
            bannerText.textContent = "No malignant pattern identified. This is not a clinical clearance.";
        }
    }

    const gaugeValue = document.getElementById("gauge-confidence-val");
    const gaugeCircle = document.getElementById("gauge-confidence-circle");
    const gaugeStatus = document.getElementById("gauge-risk-status");

    if (gaugeValue) gaugeValue.textContent = `${confidencePct}%`;
    if (gaugeCircle) {
        const r = parseFloat(gaugeCircle.getAttribute("r")) || 46;
        const circumference = 2 * Math.PI * r;
        gaugeCircle.setAttribute("stroke-dasharray", circumference.toFixed(2));
        gaugeCircle.style.strokeDashoffset = circumference * (1 - data.confidence);
        gaugeCircle.style.stroke = isHighRisk ? "#f87171" : "#34d399";
    }
    if (gaugeStatus) {
        gaugeStatus.textContent = isHighRisk ? "High risk" : "Not flagged";
        gaugeStatus.className = `label mt-1.5 ${isHighRisk ? "text-risk-high" : "text-risk-low"}`;
    }

    const pathologyTitle = document.getElementById("results-pathology-title");
    const pathologyCode = document.getElementById("results-pathology-code");
    const pathologyType = document.getElementById("results-pathology-type");
    const pathologyDesc = document.getElementById("results-pathology-desc");

    if (pathologyTitle) pathologyTitle.textContent = meta.name;
    if (pathologyCode) pathologyCode.textContent = meta.code;
    if (pathologyType) {
        pathologyType.textContent = meta.type;
        pathologyType.className = `chip ${isHighRisk ? "chip--high" : meta.type === "Pre-Malignant" ? "chip--mid" : "chip--low"}`;
    }
    if (pathologyDesc) pathologyDesc.textContent = meta.desc;

    const sessionEl = document.getElementById("res-session-id");
    if (sessionEl) {
        sessionEl.textContent = data.session_id
            ? `Session #${data.session_id} · EfficientNet-B3`
            : "EfficientNet-B3";
    }
    const siteEl = document.getElementById("res-anatomic-site");
    if (siteEl) siteEl.textContent = data.anatomic_site || "Not recorded";

    const thresholdEl = document.getElementById("res-threshold");
    if (thresholdEl) {
        thresholdEl.textContent = (typeof data.threshold === "number")
            ? `${data.threshold.toFixed(3)} · ${data.prediction.toUpperCase()}`
            : "—";
    }

    const latencyEl = document.getElementById("res-latency");
    if (latencyEl) latencyEl.textContent = formatMs(data.inference_ms);

    const queueEl = document.getElementById("res-queue");
    if (queueEl) queueEl.textContent = formatMs(data.queue_ms);

    const matrixContainer = document.getElementById("results-probability-matrix");
    if (matrixContainer && data.scores) {
        const sortedScores = Object.entries(data.scores).sort((a, b) => b[1] - a[1]);

        matrixContainer.innerHTML = sortedScores.map(([clsKey, prob]) => {
            const clsMeta = PATHOLOGY_META[clsKey] || { name: clsKey.toUpperCase() };
            const pct = (prob * 100).toFixed(1);
            const isTop = clsKey === data.prediction;
            const barWidth = Math.max(pct, 1.5);

            const barColor = isTop ? (isHighRisk ? "bg-risk-high" : "bg-risk-low") : "bg-on-surface-muted/45";
            const nameColor = isTop ? "text-on-surface font-semibold" : "text-on-surface-variant";
            const pctColor = isTop
                ? (isHighRisk ? "text-risk-high font-semibold" : "text-risk-low font-semibold")
                : "text-on-surface-variant";

            return `
                <div>
                    <div class="flex items-baseline justify-between gap-3 mb-1.5">
                        <span class="text-[13px] ${nameColor} truncate">
                            ${clsMeta.name}
                            <span class="font-data-sm text-[11.5px] text-on-surface-muted ml-1">${clsKey.toUpperCase()}</span>
                        </span>
                        <span class="font-data-sm text-[12.5px] tabular ${pctColor}">${pct}%</span>
                    </div>
                    <div class="h-1.5 bg-surface-container-highest rounded-full overflow-hidden" role="img" aria-label="${clsMeta.name}: ${pct} percent">
                        <div class="${barColor} h-full rounded-full transition-all duration-700" style="width: ${barWidth}%"></div>
                    </div>
                </div>
            `;
        }).join("");
    }

    const summaryEl = document.getElementById("res-clinical-summary");
    if (summaryEl) summaryEl.textContent = buildClinicalSummary(data, meta);

    renderResultsImage(data);
    renderOodPanel(data);
}

function reportFlagClass(data) {
    if (data.is_high_risk) return "pr-flag--high";
    if (data.melanoma_alert) return "pr-flag--mid";
    return "pr-flag--low";
}

function reportFlagText(data) {
    if (data.is_high_risk) return "High-risk group";
    if (data.melanoma_alert) return "Melanoma not excluded";
    return "Not flagged";
}

function buildPrintReport(data) {
    const host = document.getElementById("print-report");
    if (!host || !data) return null;

    const meta = PATHOLOGY_META[data.prediction] || {
        name: data.prediction.toUpperCase(), code: "—", type: "—", desc: "",
    };
    const generated = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${generated.getFullYear()}-${pad(generated.getMonth() + 1)}-` +
                  `${pad(generated.getDate())} ${pad(generated.getHours())}:${pad(generated.getMinutes())}`;

    const scores = data.scores || {};
    const rows = Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .map(([cls, p]) => {
            const m = PATHOLOGY_META[cls] || { name: cls.toUpperCase() };
            const pct = p * 100;
            const isTop = cls === data.prediction;
            return `
                <tr class="${isTop ? "pr-top" : ""}">
                    <td>${escapeHtml(m.name)}</td>
                    <td style="color:#5b6672">${escapeHtml(cls.toUpperCase())}</td>
                    <td class="pr-num">${pct.toFixed(1)}%</td>
                    <td style="width:38%"><div class="pr-bar"><span style="width:${Math.max(pct, 0.6)}%"></span></div></td>
                </tr>`;
        }).join("");

    const m = data.ood_metrics || {};
    const oodValue = (key) => (typeof m[key] === "number" ? m[key].toFixed(3) : "—");
    const gateNote = [
        data.ood_calibrated
            ? "Gate thresholds: fitted to data."
            : "Gate thresholds: provisional defaults, not yet fitted.",
        data.ood_feature_stage_active
            ? "Feature-space stage: active."
            : "Feature-space stage: not fitted, did not run.",
    ].join(" ");

    const submittedFigure = data.session_id ? `
        <figure class="pr-col">
            <img id="pr-image" src="${API_BASE}/history/${encodeURIComponent(data.session_id)}/image" alt="" />
            <figcaption>The image the model was given, as stored.</figcaption>
        </figure>` : `
        <figure class="pr-col">
            <div class="pr-nofig">Not available</div>
            <figcaption>The stored image for this scan could not be located.</figcaption>
        </figure>`;

    const heatmapFigure = state.heatmapBase64 ? `
        <figure class="pr-col">
            <img src="${state.heatmapBase64}" alt="" />
            <figcaption>Grad-CAM attribution over the ${IMG_INPUT_SIZE}&times;${IMG_INPUT_SIZE} model input. Indicates where
            the network attended, not lesion boundaries.</figcaption>
        </figure>` : `
        <figure class="pr-col">
            <div class="pr-nofig">Not available</div>
            <figcaption>No Grad-CAM attribution was returned for this scan.</figcaption>
        </figure>`;

    host.innerHTML = `
        <div class="pr-head">
            <div>
                <h1>Lesion triage report</h1>
                <div class="pr-sub">DermaScope Triage &middot; EfficientNet-B3, 7-class, trained on HAM10000</div>
            </div>
            <div class="pr-meta">
                Session ${data.session_id ? "#" + escapeHtml(data.session_id) : "—"}<br />
                Generated ${escapeHtml(stamp)}
            </div>
        </div>

        <div class="pr-block">
            <h2>Submitted image</h2>
            <div class="pr-cols">
                ${submittedFigure}
                ${heatmapFigure}
            </div>
        </div>

        <div class="pr-block">
            <h2>Classification</h2>
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px">
                <p class="pr-headline">${escapeHtml(meta.name)}</p>
                <span class="pr-flag ${reportFlagClass(data)}">${reportFlagText(data)}</span>
            </div>
            <div class="pr-sub" style="margin-bottom:10px">
                ${escapeHtml(data.prediction.toUpperCase())} &middot; ${escapeHtml(meta.code)} &middot;
                confidence ${(data.confidence * 100).toFixed(1)}%
            </div>
            <dl class="pr-kv">
                <div><dt>Anatomic site</dt><dd>${escapeHtml(data.anatomic_site || "Not recorded")}</dd></div>
                <div><dt>Decision threshold</dt><dd>${typeof data.threshold === "number"
                    ? data.threshold.toFixed(3) + " · " + escapeHtml(data.prediction.toUpperCase()) : "—"}</dd></div>
                <div><dt>p(melanoma)</dt><dd>${typeof data.melanoma_probability === "number"
                    ? (data.melanoma_probability * 100).toFixed(1) + "%" : "—"}</dd></div>
                <div><dt>Model inference</dt><dd>${formatMs(data.inference_ms)}</dd></div>
            </dl>
        </div>

        <div class="pr-block">
            <h2>Probability across all seven classes</h2>
            <table>
                <thead>
                    <tr><th>Class</th><th>Code</th><th class="pr-num">Probability</th><th></th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>

        <div class="pr-block">
            <h2>Input screening</h2>
            <dl class="pr-kv" style="margin-bottom:8px">
                <div><dt>Rel. contrast</dt><dd>${oodValue("rel_contrast")}</dd></div>
                <div><dt>High-freq ratio</dt><dd>${oodValue("hf_ratio")}</dd></div>
                <div><dt>Blue-green hue</dt><dd>${oodValue("blue_green")}</dd></div>
                <div><dt>Stage 1</dt><dd>${data.ood_metrics ? "Passed" : "Not reported"}</dd></div>
            </dl>
            <div class="pr-sub">${escapeHtml(gateNote)}</div>
        </div>

        <div class="pr-block">
            <h2>Summary</h2>
            <p style="margin:0 0 10px">${escapeHtml(buildClinicalSummary(data, meta))}</p>
            <div class="pr-note">
                <strong>This is not a diagnosis.</strong> The output above is a single
                classifier's probability distribution over seven lesion classes, produced from
                one image with no clinical context, history or examination. It requires
                correlation by a qualified clinician and is not a substitute for one. The
                system measures nothing about the lesion itself &mdash; no size, growth,
                pigmentation or border metric is computed &mdash; and a negative result is not
                a clearance.
            </div>
        </div>

        <div class="pr-foot">
            <span>DermaScope Triage &middot; research decision-support tool</span>
            <span>Session ${data.session_id ? "#" + escapeHtml(data.session_id) : "—"} &middot; ${escapeHtml(stamp)}</span>
        </div>
    `;

    return host;
}

function whenReportImagesSettle(host) {
    const images = [...host.querySelectorAll("img")].filter(img => img.getAttribute("src"));
    return Promise.all(images.map(img => (img.complete && img.naturalWidth)
        ? Promise.resolve()
        : new Promise(resolve => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
        })));
}

export async function downloadClinicalReport() {
    if (!state.latestResult) {
        toast("Run a scan before exporting a report.", "warning");
        return;
    }

    const data = state.latestResult;
    const host = buildPrintReport(data);
    if (!host) {
        toast("Could not assemble the report.", "error");
        return;
    }

    if (!window.html2pdf) {
        await whenReportImagesSettle(host);
        window.print();
        return;
    }

    toast("Building report…", "info");
    host.style.display = "block";
    try {
        await whenReportImagesSettle(host);
        await window.html2pdf().set({
            margin: [14, 14, 14, 14],
            filename: `DermaScope_Triage_${data.prediction}_${data.session_id || "scan"}_` +
                      `${new Date().toISOString().slice(0, 10)}.pdf`,
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
            jsPDF: { unit: "mm", format: "letter", orientation: "portrait" },
            pagebreak: { mode: ["css", "legacy"] },
        }).from(host).save();
        toast("Report downloaded.", "success");
    } catch (err) {
        toast("Could not generate the PDF: " + err.message, "error");
    } finally {
        host.style.display = "";
    }
}
