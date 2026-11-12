/* Model card view: reads /api/model and renders measured evaluation and provenance. */

import { HIGH_RISK_CLASSES, MODEL_CARD_CLASS_ORDER, PATHOLOGY_META, state } from "./config.js";
import { apiCall, formatPct, setText, toast } from "./utils.js";

function mcNum(value, digits = 3) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    return value.toFixed(digits);
}

function renderModelProvenance(card) {
    const box = document.getElementById("model-provenance");
    const icon = document.getElementById("model-provenance-icon");
    const text = document.getElementById("model-provenance-text");
    if (!box || !icon || !text) return;

    const base = "px-4 py-3 rounded-xl border flex items-start gap-3";
    const iconBase = "material-symbols-outlined text-[20px] shrink-0 mt-0.5";

    if (!card.evaluation_available) {
        box.className = `${base} border-risk-mid/35 bg-risk-mid/10`;
        icon.className = `${iconBase} text-risk-mid`;
        icon.textContent = "warning";
        text.textContent =
            "No recorded evaluation is available to this server, so the figures below cannot be " +
            "shown. The serving configuration is still reported.";
        return;
    }

    if (card.evaluation_describes_this_configuration === true) {
        box.className = `${base} border-risk-low/35 bg-risk-low/10`;
        icon.className = `${iconBase} text-risk-low`;
        icon.textContent = "check_circle";
        text.textContent =
            "These figures were measured under the same per-class decision thresholds this server " +
            "is using, so they describe the configuration you are running.";
        return;
    }

    if (card.evaluation_describes_this_configuration === false) {
        const differing = (card.evaluation_threshold_mismatches || [])
            .map(m => `${m.class.toUpperCase()} ${m.evaluated_with} → ${m.serving}`).join(", ");
        box.className = `${base} border-risk-high/35 bg-risk-high/10`;
        icon.className = `${iconBase} text-risk-high`;
        icon.textContent = "error";
        text.textContent =
            "The recorded evaluation was measured under different decision thresholds from the ones " +
            `this server is using (${differing}). The figures below do not describe this ` +
            "configuration and should not be quoted for it.";
        return;
    }

    box.className = `${base} border-outline-variant bg-surface-container`;
    icon.className = `${iconBase} text-on-surface-variant`;
    icon.textContent = "help";
    text.textContent =
        "Whether these figures describe the running configuration could not be established: the " +
        "server has the evaluation but not the record of which thresholds it was measured under.";
}

function renderModelThresholdProvenance(card) {
    const p = card.threshold_provenance || {};
    const badge = document.getElementById("model-provenance-badge");
    const body = document.getElementById("model-provenance-body");
    const fields = document.getElementById("model-provenance-fields");
    if (!badge || !body || !fields) return;

    if (p.produced_by_pipeline && p.splits_shown_separate) {
        badge.className = "chip chip--low";
        badge.textContent = "Traceable";
        body.textContent =
            `Written by scripts/optimize_thresholds.py, fitted on ${p.fitted_on} and ` +
            `reported on ${p.reported_on} — separate splits, as that tool requires.`;
        fields.textContent = "";
        return;
    }

    badge.className = "chip chip--mid";
    badge.textContent = "Unverifiable";
    body.textContent = p.readable
        ? "This file was not written by scripts/optimize_thresholds.py, so that command " +
          "will not reproduce it — and it records no `reported_on`, which is the field " +
          "showing the thresholds were scored on a split separate from the one they were " +
          "tuned on. That separation may well have been kept; nothing here can confirm it, " +
          "so the figures below should be read as unverified rather than as measured under " +
          "a known protocol."
        : "The threshold file could not be read, so nothing about its provenance is known.";

    const missing = p.missing_fields || [];
    fields.textContent = missing.length
        ? `Missing: ${missing.join(", ")}${p.fitted_on ? ` · fitted_on: ${p.fitted_on}` : ""}`
        : "";
}

function renderModelOodState(card) {
    const g = card.ood_gate || {};
    const badge = document.getElementById("model-ood-badge");
    const body = document.getElementById("model-ood-body");
    if (!badge || !body) return;

    const both = g.thresholds_fitted && g.feature_stage_fitted;
    badge.className = "chip " + (both ? "chip--low" : "chip--mid");
    badge.textContent = both ? "Fitted" : "Not fitted";

    if (both) {
        body.textContent =
            "Colour thresholds fitted to data and the feature-space stage active. " +
            "Both stages run on every scan.";
        return;
    }

    const parts = [];
    parts.push(g.thresholds_fitted
        ? "Colour thresholds: fitted."
        : "Colour thresholds: provisional defaults, never fitted.");
    parts.push(g.feature_stage_fitted
        ? "Feature-space stage: active."
        : "Feature-space stage: never fitted, so it does not run at all.");
    parts.push("Screening is therefore a colour heuristic on unfitted numbers: it " +
               "rejects flat fields, pixel noise and non-skin hues, and cannot reject a " +
               "photograph of another real object. Run scripts/calibrate_ood.py to fit it.");
    body.textContent = parts.join(" ");
}

function renderModelHeadline(evaluation) {
    if (!evaluation) {
        ["model-accuracy", "model-macro-f1", "model-mel-recall", "model-ece"]
            .forEach(id => setText(id, "—"));
        setText("model-testset", "Evaluation unavailable");
        setText("model-mel-recall-note", "—");
        return;
    }

    setText("model-accuracy", formatPct(evaluation.accuracy));
    setText("model-macro-f1", mcNum(evaluation.macro_f1));
    setText("model-mel-recall", mcNum(evaluation.melanoma_recall));
    setText("model-ece", mcNum(evaluation.ece));

    setText("model-testset", typeof evaluation.test_set_size === "number"
        ? `${evaluation.test_set_size.toLocaleString()} held-out images`
        : "—");

    const recall = evaluation.melanoma_recall;
    if (typeof recall === "number" && recall < 0.995 && recall >= 0) {
        const missed = Math.round(1 / (1 - recall));
        setText("model-mel-recall-note", missed >= 2
            ? `Roughly one melanoma in ${missed} missed by the prediction`
            : "Missed by the prediction");
    } else {
        setText("model-mel-recall-note", "—");
    }
}

function renderModelOperatingPoint(evaluation) {
    const recall = evaluation && evaluation.melanoma_recall;
    const surfaced = evaluation && evaluation.melanoma_surfaced;
    const review = evaluation && evaluation.review_rate;

    setText("model-op-recall", formatPct(recall));
    setText("model-op-surfaced", formatPct(surfaced));
    setText("model-op-review", formatPct(review));

    if (typeof recall !== "number" || typeof surfaced !== "number") {
        setText("model-op-prose", "Evaluation unavailable.");
        return;
    }

    const missedByPrediction = 1 - recall;
    const missedEntirely = 1 - surfaced;
    const reviewText = typeof review === "number"
        ? ` That costs a review rate of ${formatPct(review)} — about ${Math.round(review * 100)} scans in every 100 are put in front of a human.`
        : "";

    setText("model-op-prose",
        `The prediction alone misses ${formatPct(missedByPrediction)} of melanomas. With the alert ` +
        `channel included, ${formatPct(missedEntirely)} are missed entirely — that is the number a ` +
        `patient would care about.${reviewText}`);
}

function renderModelPerClass(card) {
    const tbody = document.getElementById("model-per-class");
    if (!tbody) return;

    const perClass = (card.evaluation && card.evaluation.per_class) || {};
    const thresholds = card.thresholds || {};

    tbody.innerHTML = MODEL_CARD_CLASS_ORDER.map(cls => {
        const meta = PATHOLOGY_META[cls] || { name: cls.toUpperCase() };
        const m = perClass[cls] || {};
        const isHigh = HIGH_RISK_CLASSES.includes(cls);
        return `
            <tr class="border-b border-outline-variant/60 hover:bg-surface-container/60 transition-colors">
                <td class="py-3 px-5 ${isHigh ? "border-l-2 border-l-risk-high/60" : ""}">
                    <span class="text-[13px] text-on-surface">${meta.name}</span>
                    <span class="font-data-sm text-[11.5px] text-on-surface-muted ml-1.5">${cls.toUpperCase()}</span>
                </td>
                <td class="py-3 px-5 text-right font-data-sm text-[13px] tabular text-on-surface-variant">${
                    typeof m.support === "number" ? m.support : "—"}</td>
                <td class="py-3 px-5 text-right font-data-sm text-[13px] tabular text-on-surface-variant">${
                    typeof thresholds[cls] === "number" ? thresholds[cls].toFixed(2) : "—"}</td>
                <td class="py-3 px-5 text-right font-data-sm text-[13px] tabular text-on-surface-variant">${mcNum(m.precision)}</td>
                <td class="py-3 px-5 text-right font-data-sm text-[13px] tabular text-on-surface">${mcNum(m.recall)}</td>
                <td class="py-3 px-5 text-right font-data-sm text-[13px] tabular text-on-surface-variant">${mcNum(m.f1)}</td>
            </tr>`;
    }).join("");
}

function renderModelConfusion(card) {
    const table = document.getElementById("model-confusion");
    if (!table) return;
    const tbody = table.querySelector("tbody");

    const matrix = card.evaluation && card.evaluation.confusion_matrix;
    const classes = card.classes || [];

    if (!Array.isArray(matrix) || !matrix.length) {
        tbody.innerHTML =
            `<tr><td class="py-6 text-[13px] text-on-surface-muted">Evaluation unavailable.</td></tr>`;
        setText("model-confusion-note", "—");
        return;
    }

    const rowTotals = matrix.map(row => row.reduce((a, b) => a + b, 0));

    const header = `
        <tr>
            <th class="label py-2 pr-3 text-left">True \\ Pred</th>
            ${classes.map(c => `<th class="label py-2 px-2 text-center">${c.toUpperCase()}</th>`).join("")}
            <th class="label py-2 pl-3 text-right">Total</th>
        </tr>`;

    const rows = matrix.map((row, i) => {
        const total = rowTotals[i] || 1;
        const cells = row.map((value, j) => {
            const share = value / total;
            const onDiagonal = i === j;
            const bg = value === 0 ? "transparent"
                : onDiagonal ? `rgba(52,211,153,${(0.10 + share * 0.45).toFixed(3)})`
                             : `rgba(248,113,113,${(0.10 + share * 0.65).toFixed(3)})`;
            const strong = value > 0 && share >= 0.08;
            return `<td class="py-2 px-2 text-center font-data-sm text-[13px] tabular rounded-sm ${
                strong ? "text-on-surface font-semibold" : "text-on-surface-variant"
            }" style="background:${bg}" title="${classes[i].toUpperCase()} predicted as ${
                classes[j].toUpperCase()}: ${value} of ${total}">${value}</td>`;
        }).join("");
        return `
            <tr class="border-b border-outline-variant/40">
                <td class="py-2 pr-3 text-[13px] text-on-surface whitespace-nowrap">${classes[i].toUpperCase()}</td>
                ${cells}
                <td class="py-2 pl-3 text-right font-data-sm text-[13px] tabular text-on-surface-muted">${rowTotals[i]}</td>
            </tr>`;
    }).join("");

    tbody.innerHTML = header + rows;

    let worst = null;
    matrix.forEach((row, i) => row.forEach((value, j) => {
        if (i !== j && (!worst || value > worst.value)) worst = { i, j, value };
    }));
    if (worst && worst.value > 0) {
        const trueName = (PATHOLOGY_META[classes[worst.i]] || {}).name || classes[worst.i];
        const predName = (PATHOLOGY_META[classes[worst.j]] || {}).name || classes[worst.j];
        const share = worst.value / (rowTotals[worst.i] || 1);
        setText("model-confusion-note",
            `Largest single confusion: ${worst.value} ${trueName} images predicted as ` +
            `${predName} — ${formatPct(share)} of all ${trueName} in the set.`);
    } else {
        setText("model-confusion-note", "—");
    }
}

function renderModelConfig(card) {
    const tbody = document.getElementById("model-config");
    if (!tbody) return;

    const d = card.decision_layer || {};
    const cp = card.checkpoint || {};
    const rows = [
        ["Backbone", `${card.backbone || "—"} (${card.architecture || "—"})`],
        ["Input size", typeof card.input_size === "number" ? `${card.input_size} px` : "—"],
        ["Training data", card.dataset || "—"],
        ["Checkpoint", `${cp.name || "—"}${cp.present ? "" : " — not present on this server"}`],
        ["Loaded", cp.loaded ? "Yes" : "Not yet — loads on the first scan"],
        ["Readout", d.readout || "—"],
        ["Temperature", mcNum(d.temperature, 2)],
        ["Melanoma alert threshold", d.mel_alert_threshold != null ? mcNum(d.mel_alert_threshold, 2) : "Disabled"],
        ["Decision layer calibrated", d.calibration_loaded ? "Yes" : "No — serving defaults"],
        ["Thresholds fitted on", card.thresholds_fitted_on || "Not recorded"],
    ];

    tbody.innerHTML = rows.map(([k, v]) => `
        <tr class="border-b border-outline-variant/60">
            <td class="py-3 px-5 text-[13px] text-on-surface-variant w-1/3">${k}</td>
            <td class="py-3 px-5 text-[13px] text-on-surface">${v}</td>
        </tr>`).join("");
}

export async function loadModelCard() {
    let card;
    try {
        card = await apiCall("/model");
    } catch (err) {
        toast("Could not load the model card: " + err.message, "error");
        return;
    }
    state.modelCard = card;

    renderModelProvenance(card);
    renderModelThresholdProvenance(card);
    renderModelOodState(card);
    renderModelHeadline(card.evaluation);
    renderModelOperatingPoint(card.evaluation);
    renderModelPerClass(card);
    renderModelConfusion(card);
    renderModelConfig(card);

    setText("model-subtitle", card.evaluation && card.evaluation.test_set_size
        ? `EfficientNet-B3 on HAM10000, measured on ${card.evaluation.test_set_size.toLocaleString()} held-out images.`
        : "What this deployment serves, and what it measured.");
}
