/* Analytics/history table, inline case label editing, CSV export, and deletion. */

import { ADMIN_TOKEN_KEY, PATHOLOGY_META, state } from "./config.js";
import { apiCall, escapeHtml, toast } from "./utils.js";

function caseCellMarkup(record) {
    const label = record.case_label;
    return `
        <td class="py-3 px-5 case-cell" data-session-id="${record.id}">
            <button type="button" class="case-edit-btn text-left text-[13px] rounded-md px-2 -mx-2 py-0.5 transition-colors ${
                label ? "text-on-surface hover:bg-surface-container-high"
                      : "text-on-surface-muted hover:text-on-surface hover:bg-surface-container-high"
            }" title="${label ? "Change the case label" : "Assign a case label"}">${
                label ? escapeHtml(label) : "+ Add"
            }</button>
        </td>`;
}

export function renderHistoryTable(records) {
    const tbody = document.getElementById("analytics-history-tbody");
    if (!tbody) return;

    if (!records.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-14 text-center text-on-surface-muted">
                    <span class="material-symbols-outlined text-[28px] block mb-2">inbox</span>
                    <p class="text-[14px] text-on-surface-variant">No scans recorded yet</p>
                    <p class="text-[13px] mt-1">Run one from the scan console and it will appear here.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = records.map(log => {
        const dt = new Date(log.created_at);
        const pad = (n) => String(n).padStart(2, "0");
        const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        const timeStr = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        const meta = PATHOLOGY_META[log.prediction] || { name: log.prediction.toUpperCase() };
        const confPct = (log.confidence * 100).toFixed(1);
        const isHigh = log.is_high_risk;

        return `
            <tr class="border-b border-outline-variant hover:bg-surface-container/70 transition-colors">
                <td class="py-3 px-5 font-data-sm text-[12px] text-on-surface-muted">#${log.id}</td>
                <td class="py-3 px-5 font-data-sm text-[12px] text-on-surface-variant tabular">${dateStr} <span class="text-on-surface-muted">${timeStr}</span></td>
                ${caseCellMarkup(log)}
                <td class="py-3 px-5 text-[13px] text-on-surface">${meta.name} <span class="font-data-sm text-[11.5px] text-on-surface-muted ml-1">${log.prediction.toUpperCase()}</span></td>
                <td class="py-3 px-5 font-data-sm text-[13px] tabular text-right ${isHigh ? "text-risk-high" : "text-on-surface"}">${confPct}%</td>
                <td class="py-3 px-5">
                    ${isHigh
                        ? `<span class="chip chip--high">High risk</span>`
                        : `<span class="chip chip--low">Not flagged</span>`}
                </td>
                <td class="py-3 px-5 text-right">
                    <div class="inline-flex items-center gap-1">
                        <button type="button" data-compare-id="${log.id}" class="btn-icon history-compare-btn" aria-label="Compare record ${log.id}" title="Open in Compare">
                            <span class="material-symbols-outlined">view_column</span>
                        </button>
                        <button type="button" data-delete-id="${log.id}" class="btn-icon history-delete-btn hover:text-risk-high" aria-label="Delete record ${log.id}" title="Delete record">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

export async function loadAnalyticsData() {
    const historyTableBody = document.getElementById("analytics-history-tbody");
    if (!historyTableBody) return;

    historyTableBody.innerHTML = `
        <tr>
            <td colspan="7" class="py-14 text-center text-on-surface-muted text-[13px]">
                <span class="material-symbols-outlined animate-spin text-[22px] block mb-2">progress_activity</span>
                Loading records&hellip;
            </td>
        </tr>
    `;

    try {
        const logs = await apiCall("/history");
        state.history = logs;

        const totalScans = logs.length;
        const highRiskCount = logs.filter(l => l.is_high_risk).length;
        const lowRiskCount = totalScans - highRiskCount;
        const avgConfidence = totalScans > 0
            ? (logs.reduce((acc, l) => acc + l.confidence, 0) / totalScans * 100).toFixed(1)
            : 0;

        const kpiTotal = document.getElementById("kpi-total-scans");
        const kpiHigh = document.getElementById("kpi-high-risk");
        const kpiLow = document.getElementById("kpi-low-risk");
        const kpiAvgConf = document.getElementById("kpi-avg-confidence");

        if (kpiTotal) kpiTotal.textContent = totalScans;
        if (kpiHigh) kpiHigh.textContent = highRiskCount;
        if (kpiLow) kpiLow.textContent = lowRiskCount;
        if (kpiAvgConf) kpiAvgConf.textContent = `${avgConfidence}%`;

        renderHistoryTable(logs);
    } catch (err) {
        toast("Failed to load historical analytics: " + err.message, "error");
    }
}

function getStoredAdminToken() {
    try {
        return window.localStorage.getItem(ADMIN_TOKEN_KEY) || "";
    } catch (_) {
        return "";
    }
}

function setStoredAdminToken(value) {
    try {
        if (value) window.localStorage.setItem(ADMIN_TOKEN_KEY, value);
        else window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch (_) { /* non-fatal */ }
}

function requestAdminToken() {
    const existing = getStoredAdminToken();
    if (existing) return existing;
    const entered = window.prompt(
        "Deleting a record requires the admin token.\n\n" +
        "This is the ADMIN_TOKEN value set in the server's .env file. " +
        "It is stored in this browser only."
    );
    const token = (entered || "").trim();
    if (token) setStoredAdminToken(token);
    return token;
}

export async function deleteHistoryRecord(id) {
    if (!confirm(`Are you sure you want to delete scan log #${id}?`)) return;

    const token = requestAdminToken();
    if (!token) {
        toast("Delete cancelled: no admin token provided.", "warning");
        return;
    }

    try {
        await apiCall(`/history/${id}`, {
            method: "DELETE",
            headers: { "X-Admin-Token": token },
        });
        toast(`Scan log #${id} deleted.`, "success");
        loadAnalyticsData();
    } catch (err) {
        if (err.status === 401) {
            setStoredAdminToken("");
            toast("Admin token rejected. Check ADMIN_TOKEN and try again.", "error");
        } else if (err.status === 403) {
            toast("Deletion is disabled: the server has no ADMIN_TOKEN configured.", "warning");
        } else {
            toast(err.message, "error");
        }
    }
}

export function exportHistoryCSV() {
    if (!state.history || !state.history.length) {
        toast("No diagnostic scan records available to export.", "warning");
        return;
    }

    const headers = ["ID", "Timestamp", "Prediction", "Pathology_Name", "Confidence", "Is_High_Risk", "Anatomic_Site"];
    const rows = state.history.map(item => {
        const meta = PATHOLOGY_META[item.prediction] || { name: item.prediction };
        return [
            item.id,
            `"${item.created_at}"`,
            `"${item.prediction}"`,
            `"${meta.name}"`,
            (item.confidence * 100).toFixed(2) + "%",
            item.is_high_risk ? "Yes" : "No",
            `"${item.anatomic_site || ""}"`,
        ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `DermaScope_Triage_History_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("CSV history report exported successfully!", "success");
}

function renderCaseSuggestions() {
    const list = document.getElementById("case-label-suggestions");
    if (!list) return;
    list.innerHTML = (state.cases || [])
        .map(c => `<option value="${escapeHtml(c.case_label)}"></option>`).join("");
}

export async function loadCases(force = false) {
    if (!force && state.cases) return state.cases;
    try {
        state.cases = await apiCall("/cases");
    } catch (err) {
        state.cases = [];
        toast("Could not load cases: " + err.message, "error");
    }
    renderCaseSuggestions();
    return state.cases;
}

async function setCaseLabel(sessionId, label) {
    const body = await apiCall(`/history/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_label: label }),
    });

    const row = (state.history || []).find(r => r.id === body.id);
    if (row) row.case_label = body.case_label;

    await loadCases(true);
    return body;
}

export function beginCaseEdit(cell, sessionId, current) {
    if (cell.dataset.editing === "true") return;
    cell.dataset.editing = "true";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "input w-full";
    input.maxLength = 64;
    input.value = current || "";
    input.setAttribute("aria-label", `Case label for scan ${sessionId}`);
    input.setAttribute("list", "case-label-suggestions");

    cell.innerHTML = "";
    cell.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = async (commit) => {
        if (settled) return;
        settled = true;
        cell.dataset.editing = "false";

        if (!commit) {
            renderHistoryTable(state.history);
            return;
        }
        const next = input.value.trim();
        if (next === (current || "")) {
            renderHistoryTable(state.history);
            return;
        }
        try {
            await setCaseLabel(sessionId, next || null);
            toast(next ? `Filed under “${next}”` : "Case label cleared", "success");
        } catch (err) {
            toast("Could not save the case label: " + err.message, "error");
        }
        renderHistoryTable(state.history);
    };

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
}
