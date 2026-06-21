/**
 * ui-quest-fullscreen.js
 */

import {
    getRepData, saveRepData,
    getQuests, saveQuests,
    getAllNPCs, findNPCById
} from "../data-manager.js";
import {
    getWorldTimeString, getDaysDiff,
    getFloatingGold, parseItemsWithQuantity
} from "../utils.js";
import {
    buildQuestEditorHTML, bindQuestEditorEvents,
    fillForm, getCurrentFormData
} from "./ui-quest-editor.js";

let _sessionActiveNpcId  = null;
let _sessionExpandedFids = null;
let _app = null;

export function openQuestFullscreen(options = {}) {
    if (_app) { _app._doClose(); return; }
    _app = new QuestFullscreen(options);
    _app.open();
}

// ══════════════════════════════════════════════════════════════
class QuestFullscreen {

    constructor(options = {}) {
        this._isGM         = game.user.isGM;
        this._activeStatus = "all";
        this._searchText   = "";
        this._activeNpcId  = options.npcId ?? _sessionActiveNpcId;
        this._expandedFids = _sessionExpandedFids !== null
            ? new Set(_sessionExpandedFids)
            : null;
    }

    // ══════════════════════════════════════════════════════════
    // 打开 / 关闭
    // ══════════════════════════════════════════════════════════

    async open() {
        await this._loadData();

        if (this._expandedFids === null) {
            const fids = this._repData.factionOrder
                ?? Object.keys(this._repData.factions ?? {});
            this._expandedFids = new Set([...fids, "ind"]);
            _sessionExpandedFids = [...this._expandedFids];
        }

        this._el = $(`
        <div id="npc-quest-fullscreen">
            <div class="qfs-layout">
                <div class="qfs-sidebar"  id="qfs-sidebar"></div>
                <div class="qfs-body">
                    <div class="qfs-toolbar" id="qfs-toolbar"></div>
                    <div class="qfs-content" id="qfs-content"></div>
                </div>
            </div>
        </div>`);

        $("body").append(this._el);
        this._renderSidebar();
        this._renderToolbar();
        this._renderContent();

        this._escHandler = (e) => {
            if (e.key === "Escape") {
                if ($("#qfs-modal-wrap-singleton").length) {
                    this._closeModal();
                } else {
                    this._doClose();
                }
            }
        };
        document.addEventListener("keydown", this._escHandler);
    }

    _doClose() {
        _sessionActiveNpcId  = this._activeNpcId;
        _sessionExpandedFids = [...(this._expandedFids ?? [])];
        document.removeEventListener("keydown", this._escHandler);
        this._closeModal();
        this._el?.remove();
        _app = null;
    }

    async _loadData() {
        this._repData = getRepData();
        this._allNpcs = getAllNPCs(this._repData);
        this._quests  = await getQuests();
    }

    // ══════════════════════════════════════════════════════════
    // 内部模态（fixed + z-index:10000，挂在 body）
    // ══════════════════════════════════════════════════════════

    _showModal({ title, content, width = 420, buttons = [], onRender }) {
        this._closeModal();

        const btnHtml = buttons.map(b => `
            <button class="qfs-modal-btn ${b.cls ?? ""}"
                data-action="${b.action ?? ""}">
                ${b.label}
            </button>`).join("");

        const wrap = $(`
        <div class="qfs-modal-wrap" id="qfs-modal-wrap-singleton">
            <div class="qfs-modal" style="width:${width}px;max-width:94vw;">
                <div class="qfs-modal-header">
                    <span>${title}</span>
                    <button class="qfs-modal-close-btn" title="关闭 (ESC)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="qfs-modal-body">${content}</div>
                ${btnHtml
                    ? `<div class="qfs-modal-footer">${btnHtml}</div>`
                    : ""}
            </div>
        </div>`);

        $("body").append(wrap);

        wrap.find(".qfs-modal-close-btn").on("click",
            () => this._closeModal());

        wrap.on("mousedown", (e) => {
            if ($(e.target).is(".qfs-modal-wrap"))
                this._closeModal();
        });

        wrap.find(".qfs-modal-btn").on("click", (e) => {
            const action = $(e.currentTarget).data("action");
            const btn    = buttons.find(b => b.action === action);
            if (btn?.callback) btn.callback(wrap);
        });

        if (onRender) onRender(wrap);
        return wrap;
    }

    _closeModal() {
        $("#qfs-modal-wrap-singleton").remove();
    }

    // ══════════════════════════════════════════════════════════
    // 侧边栏
    // ══════════════════════════════════════════════════════════

    _renderSidebar() {
        const sb   = this._el.find("#qfs-sidebar");
        const data = this._repData;
        const factionOrder = data.factionOrder
            ?? Object.keys(data.factions ?? {});

        const totalQ    = this._isGM
            ? this._quests
            : this._filterForPlayer(this._quests);
        const totalCnt  = totalQ.length;
        const activeCnt = totalQ.filter(q => q.status === "active").length;

        let html = `
        <div class="qfs-sb-header">
            <i class="fas fa-scroll"></i> 任务管理
            <button class="qfs-close-btn" id="qfs-close-btn"
                title="关闭 (ESC)">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="qfs-sb-scroll">
            <div class="qfs-npc-row
                ${this._activeNpcId === null ? "active" : ""}"
                data-npcid="__ALL__">
                <div class="qfs-npc-avatar-placeholder">
                    <i class="fas fa-layer-group"></i>
                </div>
                <div class="qfs-npc-info">
                    <div class="qfs-npc-name">全部任务</div>
                    <div class="qfs-npc-sub">所有 NPC</div>
                </div>
                <div class="qfs-npc-meta">
                    ${activeCnt > 0
                        ? `<span class="qfs-dot active">${activeCnt}</span>`
                        : ""}
                    ${totalCnt > 0
                        ? `<span class="qfs-dot total">${totalCnt}</span>`
                        : ""}
                </div>
            </div>
            <div class="qfs-sb-divider"></div>`;

        for (const fid of factionOrder) {
            const f = data.factions[fid];
            if (!f?.members?.length) continue;
            const expanded = this._expandedFids.has(fid);
            html += `
            <div class="qfs-faction-block">
                <div class="qfs-faction-header" data-fid="${fid}">
                    <i class="fas fa-chevron-${expanded ? "down" : "right"}
                        qfs-fchev"></i>
                    <img src="${f.img || "icons/svg/item-bag.svg"}"
                         class="qfs-faction-icon">
                    <span class="qfs-faction-name">${f.name}</span>
                    <span class="qfs-faction-count">
                        ${f.members.length}
                    </span>
                </div>
                <div class="qfs-faction-members"
                    ${expanded ? "" : "style=\"display:none\""}>
                    ${f.members.map(n => this._buildNpcRow(n)).join("")}
                </div>
            </div>`;
        }

        if (data.independent?.length > 0) {
            const expanded = this._expandedFids.has("ind");
            html += `
            <div class="qfs-faction-block">
                <div class="qfs-faction-header" data-fid="ind">
                    <i class="fas fa-chevron-${expanded ? "down" : "right"}
                        qfs-fchev"></i>
                    <span class="qfs-faction-name"
                        style="margin-left:4px;">独立 NPC</span>
                    <span class="qfs-faction-count">
                        ${data.independent.length}
                    </span>
                </div>
                <div class="qfs-faction-members"
                    ${expanded ? "" : "style=\"display:none\""}>
                    ${data.independent.map(n => this._buildNpcRow(n)).join("")}
                </div>
            </div>`;
        }

        html += `</div>`;
        sb.html(html);

        sb.find(".qfs-faction-header").on("click", (e) => {
            const fid     = $(e.currentTarget).data("fid");
            const members = $(e.currentTarget).next(".qfs-faction-members");
            const chev    = $(e.currentTarget).find(".qfs-fchev");
            if (this._expandedFids.has(fid)) {
                this._expandedFids.delete(fid);
                members.slideUp(150);
                chev.removeClass("fa-chevron-down")
                    .addClass("fa-chevron-right");
            } else {
                this._expandedFids.add(fid);
                members.slideDown(150);
                chev.removeClass("fa-chevron-right")
                    .addClass("fa-chevron-down");
            }
            _sessionExpandedFids = [...this._expandedFids];
        });

        sb.find(".qfs-npc-row").on("click", (e) => {
            const raw = $(e.currentTarget).data("npcid");
            const nid = raw === "__ALL__" ? null : String(raw);
            if (nid === this._activeNpcId) return;
            this._activeNpcId   = nid;
            _sessionActiveNpcId = nid;
            sb.find(".qfs-npc-row").removeClass("active");
            $(e.currentTarget).addClass("active");
            this._renderToolbar();
            this._renderContent();
        });

        sb.find("#qfs-close-btn").on("click", () => this._doClose());
    }

    _buildNpcRow(npc) {
        const qs = this._quests.filter(q =>
            q.npcId === npc.id || q.sharedWith?.includes(npc.id));
        const visibleQs = this._isGM ? qs : this._filterForPlayer(qs);
        const total     = visibleQs.length;
        const active    = visibleQs.filter(q => q.status === "active").length;
        const isActive  = this._activeNpcId === npc.id;

        return `
        <div class="qfs-npc-row ${isActive ? "active" : ""}"
            data-npcid="${npc.id}">
            <img src="${npc.img}" class="qfs-npc-avatar">
            <div class="qfs-npc-info">
                <div class="qfs-npc-name">${npc.name}</div>
                <div class="qfs-npc-sub">${npc.title || "平民"}</div>
            </div>
            <div class="qfs-npc-meta">
                ${active > 0
                    ? `<span class="qfs-dot active">${active}</span>` : ""}
                ${total > 0
                    ? `<span class="qfs-dot total">${total}</span>` : ""}
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    // 工具栏
    // ══════════════════════════════════════════════════════════

    _renderToolbar() {
        const npc = this._activeNpcId
            ? this._allNpcs.find(n => n.id === this._activeNpcId)
            : null;

        const dmSt     = ["all", "avail", "active", "done", "failed"];
        const dmLb     = ["全部", "可接取", "进行中", "已完成", "已失败"];
        const plSt     = ["all", "active", "done", "failed"];
        const plLb     = ["全部", "进行中", "已完成", "已失败"];
        const stKeys   = this._isGM ? dmSt : plSt;
        const stLabels = this._isGM ? dmLb : plLb;

        const statusBtns = stKeys.map((v, i) => `
            <button class="qfs-status-btn
                ${this._activeStatus === v ? "active" : ""}"
                data-status="${v}">${stLabels[i]}</button>`
        ).join("");

        const npcBar = npc
            ? `<img src="${npc.img}" class="qfs-tb-avatar">
               <div>
                   <div class="qfs-tb-name">${npc.name}</div>
                   <div class="qfs-tb-sub">
                       ${npc.title || "平民"} · 声望 ${npc.affection ?? 0}
                   </div>
               </div>`
            : `<div class="qfs-npc-avatar-placeholder"
                   style="width:36px;height:36px;font-size:1.2em;">
                   <i class="fas fa-layer-group"></i>
               </div>
               <div class="qfs-tb-name">全部任务</div>`;

        const addBtn = this._isGM
            ? `<button class="qfs-icon-btn green" id="qfs-add-btn">
                   <i class="fas fa-plus"></i> 新建任务
               </button>`
            : "";

        this._el.find("#qfs-toolbar").html(`
        <div class="qfs-tb-npc">${npcBar}</div>
        <div class="qfs-tb-center">
            <div class="qfs-status-bar">${statusBtns}</div>
        </div>
        <div class="qfs-tb-right">
            <input type="text" id="qfs-search"
                placeholder="搜索任务…"
                value="${this._searchText}"
                class="qfs-search-input">
            ${addBtn}
        </div>`);

        this._el.find(".qfs-status-btn").on("click", (e) => {
            this._activeStatus = $(e.currentTarget).data("status");
            this._el.find(".qfs-status-btn").removeClass("active");
            $(e.currentTarget).addClass("active");
            this._renderContent();
        });

        this._el.find("#qfs-search").on("input", (e) => {
            this._searchText = e.target.value;
            this._renderContent();
        });

        this._el.find("#qfs-add-btn").on("click",
            () => this._openQuestEditor(null));
    }

    // ══════════════════════════════════════════════════════════
    // 内容区
    // ══════════════════════════════════════════════════════════

    _renderContent() {
        let quests = [...this._quests];

        if (this._activeNpcId !== null) {
            quests = quests.filter(q =>
                q.npcId === this._activeNpcId ||
                q.sharedWith?.includes(this._activeNpcId));
        }

        if (!this._isGM) quests = this._filterForPlayer(quests);

        if (this._activeStatus !== "all")
            quests = quests.filter(q => q.status === this._activeStatus);

        if (this._searchText.trim()) {
            const kw = this._searchText.trim().toLowerCase();
            quests = quests.filter(q => {
                const cp    = q.currentPhase ?? 0;
                const phase = q.phases?.length > cp ? q.phases[cp] : q;
                return q.name.toLowerCase().includes(kw) ||
                    (phase.desc ?? "").toLowerCase().includes(kw);
            });
        }

        const order = { active: 0, avail: 1, done: 2, failed: 3 };
        quests.sort((a, b) =>
            (order[a.status] ?? 9) - (order[b.status] ?? 9));

        if (quests.length === 0) {
            this._el.find("#qfs-content").html(`
            <div class="qfs-empty">
                <i class="fas fa-scroll"></i>
                <p>暂无符合条件的任务</p>
            </div>`);
            return;
        }

        const html = this._activeNpcId === null
            ? this._buildGroupedContent(quests)
            : `<div class="qfs-grid">
                ${quests.map(q => this._buildCard(q)).join("")}
               </div>`;

        this._el.find("#qfs-content").html(html);
        this._bindCardEvents();
    }

    _buildGroupedContent(quests) {
        const groups = new Map();
        for (const q of quests) {
            if (!groups.has(q.npcId)) groups.set(q.npcId, []);
            groups.get(q.npcId).push(q);
        }
        let html = "";
        for (const [nid, qs] of groups) {
            const npcObj = this._allNpcs.find(n => n.id === nid);
            html += `
            <div class="qfs-group">
                <div class="qfs-group-header">
                    ${npcObj?.img
                        ? `<img src="${npcObj.img}"
                               class="qfs-group-avatar">`
                        : ""}
                    <span class="qfs-group-name">
                        ${npcObj?.name ?? "未知NPC"}
                    </span>
                    <span class="qfs-group-count">${qs.length} 条</span>
                </div>
                <div class="qfs-grid qfs-grid-inner">
                    ${qs.map(q => this._buildCard(q)).join("")}
                </div>
            </div>`;
        }
        return html;
    }

    _filterForPlayer(quests) {
        const myChar = game.user.character;
        if (!myChar) return [];
        const myId = myChar.id;
        const myGroupIds = game.actors
            .filter(a =>
                a.type.match(/party|group/i) &&
                a.testUserPermission(game.user, "OWNER"))
            .map(a => a.id);
        return quests.filter(q => {
            if (!["active", "done", "failed"].includes(q.status))
                return false;
            if (q.targetId === "ALL") return true;
            const tIds = q.targetId?.split(",") ?? [];
            return tIds.includes(myId) ||
                tIds.some(id => myGroupIds.includes(id));
        });
    }

    // ══════════════════════════════════════════════════════════
    // 卡片
    // ══════════════════════════════════════════════════════════

    _buildCard(q) {
        const npcObj  = this._allNpcs.find(n => n.id === q.npcId);
        const cp      = q.currentPhase ?? 0;
        const phase   = q.phases?.length > cp ? q.phases[cp] : q;

        const stMap = {
            avail:  { color: "#7f8c8d", label: "可接取", cls: "gray"  },
            active: { color: "#3498db", label: "进行中", cls: "blue"  },
            done:   { color: "#27ae60", label: "已完成", cls: "green" },
            failed: { color: "#e74c3c", label: "已失败", cls: "red"   }
        };
        const st = stMap[q.status] ?? stMap.avail;

        // useScale 已全局关闭，直接用基础金额
        const goldDisplay = phase.goldNum || 0;
        const itemsText   = parseItemsWithQuantity(phase.items ?? "")
            .map(i => `${i.name}${i.qty > 1 ? "×" + i.qty : ""}`)
            .join("、") || "无";

        const tags = [];
        if (q.phases?.length > 1)
            tags.push(`<span class="qfs-tag blue">
                第${cp + 1}/${q.phases.length}阶段</span>`);
        if (q.isPeriodic)
            tags.push(`<span class="qfs-tag orange">周期发薪</span>`);
        if (q.npcId !== this._activeNpcId && this._activeNpcId !== null)
            tags.push(`<span class="qfs-tag purple">
                共享自 ${npcObj?.name ?? ""}</span>`);
        if (q.ignoreAff)
            tags.push(`<span class="qfs-tag green">无门槛</span>`);
        else
            tags.push(`<span class="qfs-tag gray">
                需声望 ${q.minAff}</span>`);
        if (q.timeLimit)
            tags.push(`<span class="qfs-tag orange">
                <i class="fas fa-hourglass-half"></i>
                ${q.timeLimit}</span>`);

        const rewards = [];
        if (goldDisplay > 0)
            rewards.push(`<span>
                <i class="fas fa-coins" style="color:#f1c40f"></i>
                ${goldDisplay}${q.goldType || "gp"}</span>`);
        if (itemsText !== "无")
            rewards.push(`<span>
                <i class="fas fa-box" style="color:#aaa"></i>
                ${itemsText}</span>`);
        if (phase.posAff)
            rewards.push(`<span style="color:#2ecc71">
                <i class="fas fa-heart"></i> +${phase.posAff}</span>`);
        if (phase.negAff)
            rewards.push(`<span style="color:#e74c3c">
                <i class="fas fa-heart-broken"></i>
                -${phase.negAff}</span>`);
        rewards.push(`<span style="color:#aaa">
            <i class="fas fa-user-check"></i>
            ${q.targetName || "全体"}</span>`);

        // 时间轴
        const timelineItems = [];
        if (q.timeAccept) {
            let right = "";
            if (q.timeComplete)
                right = `<span>
                    <i class="fas fa-check-circle"
                       style="color:#27ae60"></i>
                    ${q.timeComplete}</span>`;
            else if (q.timeFail)
                right = `<span>
                    <i class="fas fa-times-circle"
                       style="color:#e74c3c"></i>
                    ${q.timeFail}</span>`;
            timelineItems.push(`
            <div class="qfs-timeline-row">
                <span>
                    <i class="fas fa-play-circle"
                       style="color:#3498db"></i>
                    ${q.timeAccept}
                </span>
                ${right}
            </div>`);
        }
        if (q.payHistory?.length > 0) {
            const ph    = q.payHistory;
            const first = ph[0];
            const last  = ph[ph.length - 1];
            const tip   = ph.map((t, i) => `第${i + 1}次: ${t}`).join("\n");
            const sum   = ph.length === 1
                ? `首次: ${first}`
                : `首次: ${first} &nbsp; 最近: ${last}`;
            timelineItems.push(`
            <div class="qfs-timeline-row qfs-pay-row" title="${tip}">
                <span>
                    <i class="fas fa-coins" style="color:#f1c40f"></i>
                    发薪 ${ph.length} 次 &nbsp; ${sum}
                </span>
            </div>`);
        }

        const timelineHtml = timelineItems.length
            ? `<div class="qfs-card-timeline">
                ${timelineItems.join("")}</div>`
            : "";

        // 操作按钮
        let actionBtns = "";
        if (this._isGM) {
            const isShared    = q.npcId !== this._activeNpcId
                && this._activeNpcId !== null;
            const isLastPhase = !q.phases ||
                q.phases.length <= 1 ||
                cp >= q.phases.length - 1;

            if (q.status === "avail") {
                actionBtns = `
                <button class="qfs-act-btn accept"
                    data-action="accept" data-qid="${q.id}">
                    <i class="fas fa-play"></i> 接取
                </button>
                ${!isShared ? `
                <button class="qfs-act-btn edit"
                    data-action="edit" data-qid="${q.id}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="qfs-act-btn del"
                    data-action="delete" data-qid="${q.id}">
                    <i class="fas fa-trash"></i>
                </button>` : ""}`;

            } else if (q.status === "active") {
                let payBtn = "";
                if (q.isPeriodic && q.lastPayTime &&
                    getDaysDiff(q.lastPayTime) >= (q.periodDays || 7)) {
                    payBtn = `
                    <button class="qfs-act-btn pay"
                        data-action="pay" data-qid="${q.id}">
                        <i class="fas fa-hand-holding-usd"></i> 发薪
                    </button>`;
                }
                actionBtns = `
                <button class="qfs-act-btn complete"
                    data-action="complete" data-qid="${q.id}">
                    <i class="fas fa-check"></i>
                    ${isLastPhase ? "完成" : "阶段结算"}
                </button>
                ${payBtn}
                <button class="qfs-act-btn fail"
                    data-action="fail" data-qid="${q.id}">
                    <i class="fas fa-times"></i> 失败
                </button>
                ${!isShared ? `
                <button class="qfs-act-btn edit"
                    data-action="edit" data-qid="${q.id}">
                    <i class="fas fa-edit"></i>
                </button>` : ""}`;

            } else {
                actionBtns = `
                <button class="qfs-act-btn reset"
                    data-action="reset" data-qid="${q.id}">
                    <i class="fas fa-undo"></i> 重置
                </button>
                ${!isShared ? `
                <button class="qfs-act-btn del"
                    data-action="delete" data-qid="${q.id}">
                    <i class="fas fa-trash"></i>
                </button>` : ""}`;
            }
        }

        return `
        <div class="qfs-card" data-qid="${q.id}"
            style="border-top-color:${st.color}">
            <div class="qfs-card-top">
                <span class="qfs-card-name">${q.name}</span>
                <span class="qfs-status-pill ${st.cls}">${st.label}</span>
            </div>
            <div class="qfs-card-tags">${tags.join("")}</div>
            <div class="qfs-card-desc">${phase.desc || "暂无描述"}</div>
            <div class="qfs-card-rewards">${rewards.join("")}</div>
            ${timelineHtml}
            ${actionBtns
                ? `<div class="qfs-card-actions">${actionBtns}</div>`
                : ""}
        </div>`;
    }

    _bindCardEvents() {
        this._el.find(".qfs-card-actions").on(
            "click", ".qfs-act-btn", async (e) => {
                e.stopPropagation();
                const btn    = $(e.currentTarget);
                const action = btn.data("action");
                const qid    = String(btn.data("qid"));
                await this._handleAction(action, qid);
            });
    }

    async _handleAction(action, qid) {
        this._quests = await getQuests();
        const q = this._quests.find(x => x.id === qid);
        if (!q) return;

        switch (action) {
            case "accept":
                q.status     = "active";
                q.timeAccept = getWorldTimeString();
                await saveQuests(this._quests);
                ui.notifications.success(`「${q.name}」已接取。`);
                await this._reload();
                break;
            case "complete": this._promptSettle(q, true,  false); break;
            case "fail":     this._promptSettle(q, false, false); break;
            case "pay":      await this._executePay(q);            break;
            case "reset":    await this._doReset(q);               break;
            case "edit":     await this._openQuestEditor(q);        break;
            case "delete":   this._confirmDelete(q);               break;
        }
    }

    // ══════════════════════════════════════════════════════════
    // 结算弹窗（完整声望逻辑）
    // ══════════════════════════════════════════════════════════

    _promptSettle(q, isComplete, isFinishPeriodic) {
        this._repData = getRepData();
        this._allNpcs = getAllNPCs(this._repData);

        const npcObj = this._allNpcs.find(n => n.id === q.npcId);
        if (!npcObj) return;

        const cp         = q.currentPhase ?? 0;
        const phase      = q.phases?.length > cp ? q.phases[cp] : q;
        const baseVal    = isComplete
            ? (phase.posAff || 0)
            : -Math.abs(phase.negAff || 0);

        const isShared   = this._activeNpcId !== null
            && q.npcId !== this._activeNpcId;
        const ownerNPC   = npcObj;
        const settlerNPC = isShared
            ? (this._allNpcs.find(n => n.id === this._activeNpcId) ?? npcObj)
            : npcObj;
        const actors     = this._resolveTargetActors(q);

        const buildCol = (title, color, prefix, npcName) => {
            const pcRows = actors.map(a => `
            <div class="qfs-settle-row">
                <label>
                    <i class="fas fa-user"
                       style="color:#aaa;margin-right:4px;"></i>
                    ${a.name}
                </label>
                <input type="number"
                    class="qfs-settle-input ${prefix}-pc"
                    data-pcid="${a.id}"
                    value="${baseVal}">
            </div>`).join("");

            return `
            <div class="qfs-settle-col
                ${prefix === "owner" && isShared
                    ? "qfs-settle-col-border" : ""}">
                <div class="qfs-settle-col-title"
                    style="color:${color};">
                    ${title}：${npcName}
                </div>
                <div class="qfs-settle-row qfs-settle-row-global">
                    <label style="color:#f1c40f;font-weight:bold;">
                        🌍 全局声望
                    </label>
                    <input type="number"
                        class="qfs-settle-input"
                        id="${prefix}-global"
                        value="${baseVal}">
                </div>
                ${pcRows}
            </div>`;
        };

        const content = `
        <div class="qfs-settle-body">
            <p class="qfs-settle-hint">
                <i class="fas fa-info-circle"></i>
                请确认声望变动（0 表示无变动）：
            </p>
            <div class="qfs-settle-cols">
                ${isShared
                    ? buildCol("A. 发布人", "#9b59b6",
                               "owner", ownerNPC.name)
                    : ""}
                ${buildCol(
                    isShared ? "B. 结算人" : "A. 结算对象",
                    "#3498db", "settler", settlerNPC.name)}
            </div>
        </div>`;

        this._showModal({
            title: isComplete
                ? `结算：${q.name}（阶段 ${cp + 1}）`
                : `失败：${q.name}`,
            content,
            width: isShared ? 580 : 380,
            buttons: [
                {
                    label:  '<i class="fas fa-check-double"></i> 确认发放',
                    cls:    "qfs-modal-btn-confirm",
                    action: "confirm",
                    callback: async (wrap) => {
                        const affResults = {
                            settler: {
                                global: parseInt(
                                    wrap.find("#settler-global").val()
                                ) || 0,
                                pcs: {}
                            },
                            owner: isShared ? {
                                global: parseInt(
                                    wrap.find("#owner-global").val()
                                ) || 0,
                                pcs: {}
                            } : null
                        };
                        wrap.find(".settler-pc").each(function () {
                            affResults.settler.pcs[$(this).data("pcid")] =
                                parseInt($(this).val()) || 0;
                        });
                        if (isShared) {
                            wrap.find(".owner-pc").each(function () {
                                affResults.owner.pcs[$(this).data("pcid")] =
                                    parseInt($(this).val()) || 0;
                            });
                        }

                        this._closeModal();
                        await this._distributeRewards(q, phase, actors);

                        q.appliedAffection = affResults;
                        await this._applyAffection(
                            settlerNPC, affResults.settler,
                            `[阶段${cp + 1}] `
                            + `${isComplete ? "结算" : "失败"}: ${q.name}`
                        );
                        if (isShared && ownerNPC) {
                            await this._applyAffection(
                                ownerNPC, affResults.owner,
                                `[阶段${cp + 1}] 发布`
                                + `${isComplete ? "结算" : "失败"}: ${q.name}`
                            );
                        }
                        if (isShared) q.settlerName = settlerNPC.name;

                        if (!isComplete) {
                            q.status   = "failed";
                            q.timeFail = getWorldTimeString();
                            await saveQuests(this._quests);
                            await saveRepData(this._repData);
                            await this._reload();
                            return;
                        }

                        const isLastPhase = !q.phases ||
                            q.phases.length <= 1 ||
                            cp >= q.phases.length - 1;

                        if (!isLastPhase) {
                            this._promptNextPhase(q);
                            return;
                        }

                        if (q.isPeriodic && !q.lastPayTime) {
                            const t = getWorldTimeString();
                            q.lastPayTime = t;
                            q.payHistory  ??= [];
                            q.payHistory.push(t);
                            q.status = "active";
                        } else if (isFinishPeriodic || !q.isPeriodic) {
                            q.status       = "done";
                            q.timeComplete = getWorldTimeString();
                        }

                        await saveQuests(this._quests);
                        await saveRepData(this._repData);
                        await this._reload();
                    }
                },
                {
                    label:  "取消",
                    cls:    "qfs-modal-btn-cancel",
                    action: "cancel",
                    callback: () => this._closeModal()
                }
            ]
        });
    }

    // ── 推进阶段弹窗 ──────────────────────────────────────────
    _promptNextPhase(q) {
        this._showModal({
            title:   "推进阶段",
            content: `
            <div class="qfs-next-phase-body">
                任务存在多个阶段，进入
                <b>第 ${(q.currentPhase ?? 0) + 2} 阶段</b>，
                还是彻底完结？
            </div>`,
            width: 360,
            buttons: [
                {
                    label:  '<i class="fas fa-forward"></i> 进入下一阶段',
                    cls:    "qfs-modal-btn-confirm",
                    action: "next",
                    callback: async () => {
                        q.currentPhase = (q.currentPhase ?? 0) + 1;
                        q.status = "active";
                        this._closeModal();
                        await saveQuests(this._quests);
                        await saveRepData(this._repData);
                        await this._reload();
                    }
                },
                {
                    label: `<i class="fas fa-flag-checkered"></i> `
                         + `${q.isPeriodic ? "停在此阶段" : "彻底完结"}`,
                    cls:    "qfs-modal-btn-cancel",
                    action: "end",
                    callback: async () => {
                        if (q.isPeriodic) {
                            const t = getWorldTimeString();
                            q.lastPayTime = t;
                            q.payHistory  ??= [];
                            q.payHistory.push(t);
                            q.status = "active";
                        } else {
                            q.status       = "done";
                            q.timeComplete = getWorldTimeString();
                        }
                        this._closeModal();
                        await saveQuests(this._quests);
                        await saveRepData(this._repData);
                        await this._reload();
                    }
                }
            ]
        });
    }

    // ── 执行发薪 ──────────────────────────────────────────────
    async _executePay(q) {
        this._repData = getRepData();
        this._allNpcs = getAllNPCs(this._repData);
        const cp     = q.currentPhase ?? 0;
        const phase  = q.phases?.length > cp ? q.phases[cp] : q;
        const actors = this._resolveTargetActors(q);
        await this._distributeRewards(q, phase, actors);
        const t = getWorldTimeString();
        q.lastPayTime = t;
        q.payHistory  ??= [];
        q.payHistory.push(t);
        await saveQuests(this._quests);
        ui.notifications.success(`「${q.name}」发薪完毕！`);
        await this._reload();
    }

    // ── 重置任务 ──────────────────────────────────────────────
    async _doReset(q) {
        this._repData = getRepData();
        this._allNpcs = getAllNPCs(this._repData);

        if (q.appliedAffection) {
            const npcObj     = this._allNpcs.find(n => n.id === q.npcId);
            const isShared   = this._activeNpcId !== null
                && q.npcId !== this._activeNpcId;
            const settlerNPC = isShared
                ? (this._allNpcs.find(n => n.id === this._activeNpcId)
                   ?? npcObj)
                : npcObj;
            const rev = (src) => ({
                global: -(src?.global || 0),
                pcs: Object.fromEntries(
                    Object.entries(src?.pcs || {})
                          .map(([k, v]) => [k, -v]))
            });
            if (settlerNPC)
                await this._applyAffection(
                    settlerNPC, rev(q.appliedAffection.settler),
                    `撤销结算: ${q.name}`);
            if (isShared && npcObj && q.appliedAffection.owner)
                await this._applyAffection(
                    npcObj, rev(q.appliedAffection.owner),
                    `撤销发布记录: ${q.name}`);
            q.appliedAffection = null;
        }

        q.status       = "avail";
        q.timeAccept   = null;
        q.timeComplete = null;
        q.timeFail     = null;
        q.settlerName  = null;
        q.currentPhase = 0;
        q.lastPayTime  = null;
        q.payHistory   = [];

        await saveQuests(this._quests);
        await saveRepData(this._repData);
        ui.notifications.info(`「${q.name}」已重置。`);
        await this._reload();
    }

    // ── 删除确认 ──────────────────────────────────────────────
    _confirmDelete(q) {
        this._showModal({
            title:   "删除确认",
            content: `
            <div class="qfs-confirm-body">
                确定永久删除任务「<b>${q.name}</b>」吗？
                <br>此操作不可撤销。
            </div>`,
            width: 360,
            buttons: [
                {
                    label:  '<i class="fas fa-trash"></i> 确认删除',
                    cls:    "qfs-modal-btn-danger",
                    action: "yes",
                    callback: async () => {
                        const idx = this._quests
                            .findIndex(x => x.id === q.id);
                        if (idx > -1) this._quests.splice(idx, 1);
                        this._closeModal();
                        await saveQuests(this._quests);
                        await this._reload();
                        ui.notifications.success("任务已删除。");
                    }
                },
                {
                    label:  "取消",
                    cls:    "qfs-modal-btn-cancel",
                    action: "no",
                    callback: () => this._closeModal()
                }
            ]
        });
    }

    // ══════════════════════════════════════════════════════════
    // 编辑器：独立 Foundry 窗口，打开时全屏让路，关闭后恢复
    // ══════════════════════════════════════════════════════════

    async _openQuestEditor(q) {
        await this._loadData();

        const isNew  = !q;
        const npcId  = q?.npcId ?? this._activeNpcId;
        if (!npcId)
            return ui.notifications.warn("请先选择一个 NPC 再新建任务。");

        const { npc: npcObj, factionId } =
            findNPCById(this._repData, npcId);
        if (!npcObj)
            return ui.notifications.warn("找不到对应 NPC。");

        const allNpcsRaw     = this._allNpcs;
        const factionMembers = factionId === "ind"
            ? []
            : (this._repData.factions[factionId]?.members ?? [])
                  .filter(m => m.id !== npcObj.id);

        const pcActors    = game.actors.filter(a => a.type === "character");
        const partyActors = game.actors.filter(a =>
            a.type === "party" || a.type === "group" ||
            a.name === "组"    || a.name === "Party");

        const targetOptions =
            partyActors.map(p =>
                `<option value="${p.id}"
                    style="color:#2ecc71;font-weight:bold;">
                    👥 ${p.name}
                </option>`
            ).join("") +
            `<option value="ALL"
                style="font-weight:bold;color:#3498db;">
                全体玩家分别发放
            </option>` +
            pcActors.map(a =>
                `<option value="${a.id}">👤 ${a.name}</option>`
            ).join("");

        const shareCbsHtml = factionMembers.length > 0
            ? factionMembers.map(m => `
                <label style="display:flex;align-items:center;
                     background:#111;padding:4px 8px;border-radius:3px;
                     border:1px solid #444;cursor:pointer;margin:0;
                     color:#eee;font-size:0.95em;">
                    <input type="checkbox" class="share-cb" value="${m.id}"
                        style="width:16px;height:16px;margin:0 6px 0 0;
                               -webkit-appearance:checkbox;
                               appearance:checkbox;">
                    ${m.name}
                </label>`).join("")
            : `<span style="color:#777;font-style:italic;">
                无同派系成员。</span>`;

        const systemPresets = this._repData.settings?.rewardPresets ?? [];
        const editorHTML    = buildQuestEditorHTML(
            systemPresets, factionMembers, targetOptions, shareCbsHtml);

        const self = this;

        // 全屏让路
        this._el.css("z-index", "100");

        class QuestEditorApp extends Application {

            static get defaultOptions() {
                return foundry.utils.mergeObject(super.defaultOptions, {
                    id:        `qfs-editor-${foundry.utils.randomID()}`,
                    title:     isNew
                        ? `新建任务 — ${npcObj.name}`
                        : `编辑任务：${q?.name}`,
                    width:     700,
                    height:    "auto",
                    resizable: true,
                    classes:   ["qfs-editor-window"]
                });
            }

            async _renderInner(_data) {
                return $(`
                <div class="npc-panel qfs-editor-inner"
                    style="padding:12px;background:#1a1a1a;">
                    ${editorHTML}
                </div>`);
            }

            activateListeners(html) {
                super.activateListeners(html);

                fillForm(html, q ?? null, factionMembers, allNpcsRaw);

                bindQuestEditorEvents(html, {
                    targetNPC:         npcObj,
                    allNpcsRaw,
                    factionMembers,
                    questsData:        self._quests,
                    repData:           self._repData,
                    goldScaling:       self._repData.goldScaling,
                    getCurrentAff:     () => npcObj.affection || 0,
                    refreshBoard:      () => {},
                    syncJournalForNPC: () => {}
                });

                html.find("#act-save-quest").on("click", async () => {
                    const formData = getCurrentFormData(html);
                    if (!formData.name)
                        return ui.notifications.warn("请输入任务名称。");
                    if (!formData.targetId)
                        return ui.notifications.warn(
                            "请至少指定一个分配目标。");
                    if (!formData.phases?.length)
                        return ui.notifications.warn("请至少添加一个阶段。");

                    // 重新拉取避免并发覆盖
                    self._quests = await getQuests();

                    const qid = formData.id || foundry.utils.randomID();
                    const ex  = self._quests.find(x => x.id === qid);
                    const questObj = {
                        ...formData,
                        id:           qid,
                        npcId:        npcObj.id,
                        status:       isNew
                            ? "avail" : (ex?.status ?? "avail"),
                        timeAccept:   ex?.timeAccept   ?? null,
                        timeComplete: ex?.timeComplete ?? null,
                        timeFail:     ex?.timeFail     ?? null,
                        appliedAffection: ex?.appliedAffection ?? null,
                        payHistory:   ex?.payHistory   ?? [],
                        lastPayTime:  ex?.lastPayTime  ?? null,
                        currentPhase: ex?.currentPhase ?? 0
                    };

                    if (isNew) self._quests.push(questObj);
                    else {
                        const idx = self._quests
                            .findIndex(x => x.id === qid);
                        if (idx > -1) self._quests[idx] = questObj;
                    }

                    await saveQuests(self._quests);
                    ui.notifications.success(isNew
                        ? `任务「${questObj.name}」已创建。`
                        : `任务「${questObj.name}」已保存。`);

                    this.close();
                    if (self._el?.length) await self._reload();
                });

                html.find("#act-cancel-edit").on("click", () => {
                    fillForm(html, null, factionMembers, allNpcsRaw);
                });
            }

            async close(...args) {
                // 恢复全屏 z-index
                if (self._el?.length) {
                    self._el.css("z-index", "9000");
                }
                return super.close(...args);
            }
        }

        const editorApp = new QuestEditorApp();
        editorApp.render(true);
    }

    // ══════════════════════════════════════════════════════════
    // 辅助函数
    // ══════════════════════════════════════════════════════════

    _resolveTargetActors(q) {
        const tid = q.targetId || "ALL";
        if (tid === "ALL")
            return game.actors.filter(a => a.type === "character");

        const ids    = tid.split(",").map(s => s.trim()).filter(Boolean);
        const result = [];

        for (const id of ids) {
            const actor = game.actors.get(id);
            if (!actor) continue;

            if (actor.type.match(/party|group/i)) {
                // 尝试获取 party 成员
                const memberIds = actor.system?.members
                    ?? [];
                if (memberIds.length > 0) {
                    for (const m of memberIds) {
                        const a = game.actors.get(m.id ?? m);
                        if (a && !result.find(x => x.id === a.id))
                            result.push(a);
                    }
                } else {
                    // 回退：所有 character
                    game.actors
                        .filter(a => a.type === "character")
                        .forEach(a => {
                            if (!result.find(x => x.id === a.id))
                                result.push(a);
                        });
                }
            } else {
                if (!result.find(x => x.id === actor.id))
                    result.push(actor);
            }
        }

        return result.length > 0
            ? result
            : game.actors.filter(a => a.type === "character");
    }

    async _distributeRewards(q, phase, actors) {
        const goldNum = phase.goldNum || 0;
        const gType   = q.goldType || "gp";

        const parsedItems   = parseItemsWithQuantity(phase.items ?? "");
        const itemsToCreate = [];
        for (const it of parsedItems) {
            let itemData = null;
            if (it.type === "uuid") {
                const src = await fromUuid(it.uuid);
                if (src) itemData = src.toObject();
            } else {
                const src = game.items.getName(it.name);
                if (src) itemData = src.toObject();
            }
            if (itemData) {
                if (itemData.system?.quantity !== undefined) {
                    itemData.system.quantity = it.qty;
                    itemsToCreate.push(itemData);
                } else {
                    for (let i = 0; i < it.qty; i++)
                        itemsToCreate.push(
                            foundry.utils.duplicate(itemData));
                }
            }
        }

        for (const a of actors) {
            if (goldNum > 0) {
                const curr = foundry.utils.duplicate(
                    a.system.currency ||
                    { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
                curr[gType] = (curr[gType] || 0) + goldNum;
                await a.update({ "system.currency": curr });
            }
            if (itemsToCreate.length > 0)
                await Item.create(itemsToCreate, { parent: a });
        }
    }

    async _applyAffection(npcObj, affData, reason) {
        if (!npcObj || !affData) return;
        let changed = false;

        if (affData.global !== 0) {
            const oldVal     = npcObj.affection || 0;
            npcObj.affection = oldVal + affData.global;
            npcObj.history   ??= [];
            npcObj.history.push({
                date:   getWorldTimeString(),
                old:    oldVal,
                new:    npcObj.affection,
                change: affData.global,
                reason
            });
            changed = true;
        }

        for (const [pcid, val] of Object.entries(affData.pcs || {})) {
            if (val !== 0) {
                npcObj.playerAffection       ??= {};
                npcObj.playerAffection[pcid] ??= { affection: 0, history: [] };
                const oldVal =
                    npcObj.playerAffection[pcid].affection || 0;
                npcObj.playerAffection[pcid].affection = oldVal + val;
                npcObj.playerAffection[pcid].history.push({
                    date:   getWorldTimeString(),
                    old:    oldVal,
                    new:    oldVal + val,
                    change: val,
                    reason
                });
                changed = true;
            }
        }

        if (changed) await saveRepData(this._repData);
    }

    async _reload() {
        await this._loadData();
        this._renderSidebar();
        this._renderToolbar();
        this._renderContent();
    }
}