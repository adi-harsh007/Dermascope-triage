/* Side-by-side comparison view for two recorded scans. */

import {
    API_BASE,
    COMPARE_CLASS_ORDER,
    HIGH_RISK_CLASSES,
    PATHOLOGY_META,
    state,
} from "./config.js";
import { loadCases } from "./history.js";
import {
    apiCall,
    escapeHtml,
    formatDeltaPP,
    formatInterval,
    formatPct,
    formatRecordedAt,
    toast,
} from "./utils.js";

export const compareZoom = { a: 1.0, b: 1.0, linked: true };

const compareRequest = { a: 0, b: 0 };

export function applyCompareZoom() {
    const imgLeft = document.getElementById("img-compare-left");
    const imgRight = document.getElementById("img-compare-right");
    if (imgLeft) imgLeft.style.transform = `scale(${compareZoom.a})`;
    if (imgRight) imgRight.style.transform = `scale(${compareZoom.b})`;
}

function compareOptionLabel(rec) {
    const meta = PATHOLOGY_META[rec.prediction] || { name: rec.prediction };
    const caseBit = (!state.compareCase && rec.case_label) ? ` · ${rec.case_label}` : "";
    return `#${rec.id} · ${meta.name} · ${formatPct(rec.confidence)} · ` +
           `${formatRecordedAt(rec.created_at)}${caseBit}`;
}

function populateCompareSelectors() {
    let records = state.history || [];
    if (state.compareCase) {
        records = records
            .filter(r => r.case_label === state.compareCase)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    ["A", "B"].forEach(slot => {
        const select = document.getElementById(`compare-select-${slot.toLowerCase()}`);
        if (!select) return;
        const chosen = select.value;
        select.innerHTML = `<option value="">Select a recorded scan…</option>` +
            records.map(r => `<option value="${r.id}">${escapeHtml(compareOptionLabel(r))}</option>`).join("");
        if (chosen && records.some(r => String(r.id) === String(chosen))) {
            select.value = chosen;
        }
    });
}

function renderCompareCaseFilter() {
    const select = document.getElementById("compare-case-filter");
    if (!select) return;
    const chosen = select.value;
    select.innerHTML = `<option value="">All scans</option>` +
        (state.cases || []).map(c =>
            `<option value="${escapeHtml(c.case_label)}">${escapeHtml(c.case_label)} · ${
                c.scan_count} scan${c.scan_count === 1 ? "" : "s"}</option>`).join("");
    if (chosen && (state.cases || []).some(c => c.case_label === chosen)) {
        select.value = chosen;
    }
}

export async function applyCompareCaseFilter(label) {
    state.compareCase = label || null;
    populateCompareSelectors();

    const hint = document.getElementById("compare-case-hint");
    if (!label) {
        if (hint) {
            hint.textContent =
                "Pick a case to narrow both lists to its scans, oldest and newest preselected.";
        }
        return;
    }

    const scans = (state.history || [])
        .filter(r => r.case_label === label)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (hint) {
        hint.textContent = scans.length < 2
            ? `“${label}” has ${scans.length} scan. Two are needed to compare.`
            : `“${label}”: ${scans.length} scans. Showing the oldest and the newest.`;
    }

    if (scans.length >= 2) {
        const a = String(scans[0].id);
        const b = String(scans[scans.length - 1].id);
        const selectA = document.getElementById("compare-select-a");
        const selectB = document.getElementById("compare-select-b");
        if (selectA) selectA.value = a;
        if (selectB) selectB.value = b;
        await setCompareSlot("A", a);
        await setCompareSlot("B", b);
    }
}

function renderCompareImage(slot, rec) {
    const isA = slot === "A";
    const img = document.getElementById(isA ? "img-compare-left" : "img-compare-right");
    const missing = document.getElementById(isA ? "compare-a-missing" : "compare-b-missing");
    if (!img || !missing) return;

    const showMissing = () => {
        img.classList.add("hidden");
        missing.classList.remove("hidden");
        missing.classList.add("flex");
    };

    if (!rec.has_image) {
        showMissing();
        return;
    }

    img.onerror = showMissing;
    img.onload = () => {
        missing.classList.add("hidden");
        missing.classList.remove("flex");
        img.classList.remove("hidden");
    };
    img.src = `${API_BASE}/history/${encodeURIComponent(rec.id)}/image`;
}

function renderCompareHeader(slot, rec) {
    const isA = slot === "A";
    const caption = document.getElementById(isA ? "compare-a-caption" : "compare-b-caption");
    const chip = document.getElementById(isA ? "compare-a-chip" : "compare-b-chip");
    const meta = PATHOLOGY_META[rec.prediction] || { name: rec.prediction };

    if (caption) caption.textContent = `#${rec.id} · ${formatRecordedAt(rec.created_at)}`;
    if (chip) {
        chip.textContent = `${meta.name} ${formatPct(rec.confidence)}`;
        chip.className = "chip shrink-0 " + (rec.is_high_risk ? "chip--high" : "chip--low");
    }
}

function renderCompareSummary(a, b) {
    const agrees = a.prediction === b.prediction;
    const metaA = PATHOLOGY_META[a.prediction] || { name: a.prediction };
    const metaB = PATHOLOGY_META[b.prediction] || { name: b.prediction };

    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    set("compare-agreement", agrees ? "Same" : "Different");
    set("compare-agreement-detail", agrees ? metaA.name : `A: ${metaA.name} · B: ${metaB.name}`);

    const confDelta = b.confidence - a.confidence;
    set("compare-conf-delta", formatDeltaPP(confDelta));
    set("compare-conf-detail", agrees
        ? `${formatPct(a.confidence)} → ${formatPct(b.confidence)}`
        : "Different classes — not a like-for-like change");

    set("compare-interval", formatInterval(
        new Date(a.created_at).getTime(), new Date(b.created_at).getTime()
    ));

    const siteA = a.anatomic_site || "Not recorded";
    const siteB = b.anatomic_site || "Not recorded";
    set("compare-site", siteA === siteB ? siteA : `A: ${siteA} · B: ${siteB}`);

    const sameCase = Boolean(a.case_label) && a.case_label === b.case_label;
    if (sameCase) {
        set("compare-case", a.case_label);
        set("compare-case-detail", "Both scans filed here");
    } else if (a.case_label || b.case_label) {
        set("compare-case", "Different");
        set("compare-case-detail",
            `A: ${a.case_label || "unfiled"} · B: ${b.case_label || "unfiled"}`);
    } else {
        set("compare-case", "Unfiled");
        set("compare-case-detail", "Neither scan has a case label");
    }

    const note = document.getElementById("compare-identity-note");
    if (note) {
        note.innerHTML = sameCase
            ? `<span class="font-semibold text-on-surface">You have filed both scans under ` +
              `“${escapeHtml(a.case_label)}”.</span> That is your assertion that they show the same ` +
              "lesion — the application did not determine it and cannot check it. Read in that order, " +
              "A is the earlier record and B the later one."
            : `<span class="font-semibold text-on-surface">These are two independent inferences.</span> ` +
              "Neither scan is filed with the other under a case label, so nothing here indicates they " +
              "show the same lesion. Assign a case in History if they do.";
    }
}

function renderCompareClassTable(a, b) {
    const tbody = document.getElementById("compare-class-table");
    if (!tbody) return;

    const scoresA = a.scores || {};
    const scoresB = b.scores || {};

    tbody.innerHTML = COMPARE_CLASS_ORDER.map(cls => {
        const meta = PATHOLOGY_META[cls] || { name: cls.toUpperCase() };
        const pA = typeof scoresA[cls] === "number" ? scoresA[cls] : null;
        const pB = typeof scoresB[cls] === "number" ? scoresB[cls] : null;
        const delta = (pA === null || pB === null) ? null : pB - pA;

        const half = delta === null ? 0 : Math.min(Math.abs(delta) * 100 / 2, 50);
        const positive = (delta || 0) > 0;
        const bar = delta === null ? "" : `
            <div class="relative h-1.5 w-full bg-surface-container rounded-full">
                <span class="absolute inset-y-0 left-1/2 w-px bg-outline"></span>
                <span class="absolute inset-y-0 ${positive ? "left-1/2" : "right-1/2"} bg-primary rounded-full"
                      style="width: ${half}%"></span>
            </div>`;

        const isHigh = HIGH_RISK_CLASSES.includes(cls);
        const topA = cls === a.prediction;
        const topB = cls === b.prediction;

        return `
            <tr class="border-b border-outline-variant/60">
                <td class="py-2.5 pr-4 ${isHigh ? "border-l-2 border-l-risk-high/60 pl-3" : "pl-3"}">
                    <span class="text-[13px] ${topA || topB ? "text-on-surface font-medium" : "text-on-surface-variant"}">${meta.name}</span>
                    <span class="font-data-sm text-[12px] text-on-surface-muted ml-1.5">${cls.toUpperCase()}</span>
                </td>
                <td class="py-2.5 px-3 text-right font-data-sm text-[13px] tabular ${topA ? "text-on-surface font-semibold" : "text-on-surface-variant"}">${formatPct(pA)}</td>
                <td class="py-2.5 px-3 text-right font-data-sm text-[13px] tabular ${topB ? "text-on-surface font-semibold" : "text-on-surface-variant"}">${formatPct(pB)}</td>
                <td class="py-2.5 px-3 text-right font-data-sm text-[13px] tabular text-on-surface-variant">${formatDeltaPP(delta)}</td>
                <td class="py-2.5 pl-3">${bar}</td>
            </tr>
        `;
    }).join("");
}

function renderCompareDetailTable(a, b) {
    const tbody = document.getElementById("compare-detail-table");
    if (!tbody) return;

    const yesNo = (v) => (v ? "Yes" : "No");
    const metaName = (rec) => (PATHOLOGY_META[rec.prediction] || { name: rec.prediction }).name;
    const num = (v, digits) => (typeof v === "number" ? v.toFixed(digits) : "—");

    const rows = [
        ["Session id", `#${a.id}`, `#${b.id}`],
        ["Recorded", formatRecordedAt(a.created_at), formatRecordedAt(b.created_at)],
        ["Predicted class", `${metaName(a)} (${a.prediction.toUpperCase()})`,
                            `${metaName(b)} (${b.prediction.toUpperCase()})`],
        ["Confidence", formatPct(a.confidence), formatPct(b.confidence)],
        ["High-risk group", yesNo(a.is_high_risk), yesNo(b.is_high_risk)],
        ["Melanoma alert", yesNo(a.melanoma_alert), yesNo(b.melanoma_alert)],
        ["p(melanoma)", formatPct(a.melanoma_probability), formatPct(b.melanoma_probability)],
        ["Decision threshold", num(a.threshold_used, 3), num(b.threshold_used, 3)],
        ["Case", a.case_label || "Unfiled", b.case_label || "Unfiled"],
        ["Anatomic site", a.anatomic_site || "Not recorded", b.anatomic_site || "Not recorded"],
        ["Image retained", yesNo(a.has_image), yesNo(b.has_image)],
    ];

    tbody.innerHTML = rows.map(([field, va, vb]) => `
        <tr class="border-b border-outline-variant/60">
            <td class="py-2.5 pr-4 text-[13px] text-on-surface-variant">${escapeHtml(field)}</td>
            <td class="py-2.5 px-3 text-[13px] text-on-surface">${escapeHtml(va)}</td>
            <td class="py-2.5 px-3 text-[13px] text-on-surface">${escapeHtml(vb)}</td>
        </tr>
    `).join("");
}

export function renderCompare() {
    const empty = document.getElementById("compare-empty");
    const content = document.getElementById("compare-content");
    const { a, b } = state.compare;

    if (!a || !b) {
        if (empty) empty.classList.remove("hidden");
        if (content) {
            content.classList.add("hidden");
            content.classList.remove("flex");
        }
        return;
    }

    if (empty) empty.classList.add("hidden");
    if (content) {
        content.classList.remove("hidden");
        content.classList.add("flex");
    }

    if (a.case_label && a.case_label === b.case_label
            && new Date(a.created_at) > new Date(b.created_at)) {
        [state.compare.a, state.compare.b] = [b, a];
        renderCompare();
        return;
    }

    renderCompareHeader("A", a);
    renderCompareHeader("B", b);
    renderCompareImage("A", a);
    renderCompareImage("B", b);
    renderCompareSummary(a, b);
    renderCompareClassTable(a, b);
    renderCompareDetailTable(a, b);
    applyCompareZoom();
}

export async function setCompareSlot(slot, id) {
    const key = slot === "A" ? "a" : "b";
    const ticket = ++compareRequest[key];

    if (!id) {
        state.compare[key] = null;
        renderCompare();
        return;
    }
    try {
        const record = await apiCall(`/history/${encodeURIComponent(id)}`);
        if (ticket !== compareRequest[key]) return;
        state.compare[key] = record;
    } catch (err) {
        if (ticket !== compareRequest[key]) return;
        state.compare[key] = null;
        toast(`Could not load scan #${id}: ${err.message}`, "error");
    }
    renderCompare();
}

export function swapCompareSlots() {
    const selectA = document.getElementById("compare-select-a");
    const selectB = document.getElementById("compare-select-b");
    const { a, b } = state.compare;
    state.compare.a = b;
    state.compare.b = a;
    if (selectA && selectB) {
        const va = selectA.value;
        selectA.value = selectB.value;
        selectB.value = va;
    }
    const za = compareZoom.a;
    compareZoom.a = compareZoom.b;
    compareZoom.b = za;
    renderCompare();
}

export async function loadCompareRecords(force = false) {
    if (force || !state.history || !state.history.length) {
        try {
            state.history = await apiCall("/history");
        } catch (err) {
            toast("Could not load scan records: " + err.message, "error");
            return;
        }
    }
    await loadCases(true);
    renderCompareCaseFilter();
    populateCompareSelectors();

    if (state.compare.pendingA) {
        const id = state.compare.pendingA;
        state.compare.pendingA = null;
        const select = document.getElementById("compare-select-a");
        if (select && state.history.some(r => String(r.id) === String(id))) {
            select.value = String(id);
            await setCompareSlot("A", id);
        }
    }
    renderCompare();
}

