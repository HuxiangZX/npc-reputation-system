/**
 * ui-faction-manager.js
 * NPC与派系管理中枢（宏1主面板）
 * 备份功能拆分到 ui-backup.js，系统设置拆分到 ui-settings-panel.js
 */

import { getRepData, saveRepData, getRepJournal } from "../data-manager.js";
import { openBackupCenter }    from "./ui-backup.js";
import { openSettingsPanel }   from "./ui-settings-panel.js";

// 记录哪些派系面板是展开状态（刷新时保持）
let _expandedFactions = [];
// 记录派系设置里哪些条目是展开的
let _expandedSettingsFactions = [];

// ─── 拖拽排序工具函数（通用） ─────────────────────────────────
function bindDragAndDrop(containerElement, itemSelector, handleSelector, onSortComplete) {
    let draggedItem = null;
    let isHandleHovered = false;
    const $container = $(containerElement);

    $container.on("mouseenter", handleSelector, () => isHandleHovered = true);
    $container.on("mouseleave", handleSelector, () => isHandleHovered = false);

    $container.find(itemSelector).each(function () {
        this.setAttribute("draggable", "true");

        this.addEventListener("dragstart", function (e) {
            if (!isHandleHovered) { e.preventDefault(); return; }
            draggedItem = this;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", "sortable");
            setTimeout(() => (this.style.opacity = "0.4"), 0);
        });

        this.addEventListener("dragend", function () {
            draggedItem = null;
            this.style.opacity = "1";
            $container.find(itemSelector).removeClass("drag-over-top drag-over-bottom");
            if (onSortComplete) onSortComplete();
        });

        this.addEventListener("dragover", function (e) {
            e.preventDefault();
            if (!draggedItem || this === draggedItem) return;
            const mid = this.getBoundingClientRect().top + this.getBoundingClientRect().height / 2;
            if (e.clientY < mid) $(this).addClass("drag-over-top").removeClass("drag-over-bottom");
            else                  $(this).addClass("drag-over-bottom").removeClass("drag-over-top");
        });

        this.addEventListener("dragleave", function () {
            $(this).removeClass("drag-over-top drag-over-bottom");
        });

        this.addEventListener("drop", function (e) {
            e.preventDefault();
            if (!draggedItem || this === draggedItem) return;
            $(this).removeClass("drag-over-top drag-over-bottom");
            const mid = this.getBoundingClientRect().top + this.getBoundingClientRect().height / 2;
            if (e.clientY < mid) this.parentNode.insertBefore(draggedItem, this);
            else                  this.parentNode.insertBefore(draggedItem, this.nextSibling);
        });
    });
}

// ─── 主入口 ───────────────────────────────────────────────────
export function openAdminPanel(expandedFactions = _expandedFactions) {
    const journal = getRepJournal();
    if (!journal) return ui.notifications.error("未找到声望数据库，请先确认 Journal 存在！");

    const data = getRepData();

    // 保证 factionOrder 与实际 factions 同步
    data.factionOrder = (data.factionOrder || []).filter(id => data.factions[id]);
    Object.keys(data.factions).forEach(id => {
        if (!data.factionOrder.includes(id)) data.factionOrder.push(id);
    });

    // ── 刷新函数 ──────────────────────────────────────────────
    const refresh = () => {
        // 记录当前展开状态
        if (app?.element) {
            _expandedFactions = [];
            app.element.find(".npc-list").each(function () {
                if ($(this).is(":visible")) _expandedFactions.push($(this).data("fid"));
            });
        }
        app?.close();
        openAdminPanel(_expandedFactions);
    };

    // ── 渲染单个 NPC 行 ───────────────────────────────────────
    const renderNpc = (npc, fId) => {
        const titleDisplay = (fId === "ind" || !fId) ? "无派系" : (npc.title || "平民");

        return `
        <div class="npc-item" data-nid="${npc.id}">
            <div class="drag-handle"><i class="fas fa-grip-vertical"></i></div>
            <img src="${npc.img}" class="npc-img open-sheet" data-id="${npc.actorId}">
            <div class="npc-main-info">
                <div class="npc-name-row">
                    ${npc.name}
                    <span class="rank-tag">${titleDisplay}</span>
                </div>
            </div>
            <div style="display:flex; gap:4px;">
                <button class="n-btn edit-npc-f" data-nid="${npc.id}" data-fid="${fId || "ind"}"
                    style="padding:4px 8px; background:#2980b9;">
                    <i class="fas fa-user-edit"></i>
                </button>
                <button class="n-btn del-npc" data-nid="${npc.id}" data-fid="${fId || ""}"
                    style="color:#e74c3c; padding:4px 8px;">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>`;
    };

    // ── 构建完整HTML ──────────────────────────────────────────
    const factionsHtml = data.factionOrder.map(id => {
        const f = data.factions[id];
        const isExpanded = expandedFactions.includes(id);
        return `
        <div class="faction-block" data-fid="${id}">
            <div class="f-header">
                <div class="drag-handle"><i class="fas fa-grip-lines"></i></div>
                <img src="${f.img || "icons/svg/item-bag.svg"}"
                     class="f-icon edit-f-img" data-fid="${id}">
                <span style="flex:1; font-weight:bold;">${f.name} (${f.members.length})</span>
                <i class="fas ${isExpanded ? "fa-chevron-down" : "fa-chevron-left"} toggle-icon"></i>
            </div>
            <div class="npc-list" data-fid="${id}"
                 style="display:${isExpanded ? "block" : "none"}">
                ${f.members.map(m => renderNpc(m, id)).join("")}
            </div>
        </div>`;
    }).join("");

    const isIndExpanded = expandedFactions.includes("ind");

    const app = new Dialog({
        title:   "NPC & 派系管理中枢",
        content: `<div class="npc-admin">
            <div class="admin-scroll-area" id="main-faction-container">
                ${factionsHtml}
                <div class="faction-block indep-block">
                    <div class="f-header" style="border-left:4px solid #e67e22;">
                        <span style="margin-left:34px; font-weight:bold; flex:1;">
                            独立 NPC (${data.independent.length})
                        </span>
                        <i class="fas ${isIndExpanded ? "fa-chevron-down" : "fa-chevron-left"} toggle-icon"></i>
                    </div>
                    <div class="npc-list" data-fid="ind"
                         style="display:${isIndExpanded ? "block" : "none"}">
                        ${data.independent.map(m => renderNpc(m, null)).join("")}
                    </div>
                </div>
            </div>


            <div class="footer-tools">
                <button class="n-btn add-npc-btn" style="flex:1.5; background:#27ae60;">
                    <i class="fas fa-user-plus"></i> 录入
                </button>
                <button class="n-btn manage-f-btn" style="flex:1.5;">
                    <i class="fas fa-sitemap"></i> 派系
                </button>
                <button class="n-btn open-bk-btn" style="flex:1.5; background:#d35400;">
                    <i class="fas fa-hdd"></i> 备份
                </button>
                <button class="n-btn close-main-btn" style="flex:0.5; background:#c0392b;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>`,
        buttons: {},
        render:  (html) => _bindAdminEvents(html, data, journal, refresh, renderNpc, expandedFactions)
    }, { width: 550, height: "auto", resizable: true });

    app.render(true);
}

// ─── 事件绑定 ─────────────────────────────────────────────────
function _bindAdminEvents(html, data, journal, refresh, renderNpc, expandedFactions) {

    html.find(".close-main-btn").click(() =>
        html.closest(".app").find(".header-button.close").trigger("click")
    );


    // ── 备份中心按钮 ──────────────────────────────────────────
    html.find(".open-bk-btn").click(() =>
        openBackupCenter(data, journal, refresh)
    );

    // ── 拖拽排序：派系块 ──────────────────────────────────────
    bindDragAndDrop(
        html.find("#main-faction-container")[0],
        ".faction-block:not(.indep-block)",
        ".drag-handle",
        async () => {
            const newOrder = [];
            html.find("#main-faction-container .faction-block:not(.indep-block)")
                .each(function () { newOrder.push($(this).data("fid")); });
            data.factionOrder = newOrder;
            await saveRepData(data);
        }
    );

    // ── 拖拽排序：NPC列表 ─────────────────────────────────────
    html.find(".npc-list").each(function () {
        bindDragAndDrop(this, ".npc-item", ".drag-handle", async () => {
            const fid        = $(this).data("fid");
            const newMembers = [];
            $(this).find(".npc-item").each(function () {
                const nid = $(this).data("nid");
                const npc = fid === "ind"
                    ? data.independent.find(n => n.id === nid)
                    : data.factions[fid].members.find(n => n.id === nid);
                if (npc) newMembers.push(npc);
            });
            if (fid === "ind") data.independent            = newMembers;
            else               data.factions[fid].members  = newMembers;
            await saveRepData(data);
        });
    });

    // ── 派系折叠展开 ─────────────────────────────────────────
    html.find(".f-header").click(function (e) {
        if ($(e.target).closest(".edit-f-img, .drag-handle").length) return;
        $(this).find(".toggle-icon")
               .toggleClass("fa-chevron-down fa-chevron-left");
        $(this).next(".npc-list").slideToggle(200);
    });

    // ── 角色卡快开 ───────────────────────────────────────────
    html.find(".open-sheet").click(e =>
        game.actors.get($(e.currentTarget).data("id"))?.sheet.render(true)
    );

    // ── 修改NPC归属 ───────────────────────────────────────────
    html.find(".edit-npc-f").click(e => {
       const nid    = $(e.currentTarget).data("nid");
        const oldFid = $(e.currentTarget).data("fid");
        let npc      = oldFid === "ind"
            ? data.independent.find(n => n.id === nid)
            : data.factions[oldFid]?.members.find(n => n.id === nid);
        if (!npc) return;

        const fOpts = data.factionOrder
            .map(id => `<option value="${id}" ${id === oldFid ? "selected" : ""}>
                ${data.factions[id].name}</option>`)
            .join("");

        new Dialog({
            title:   `修改人物: ${npc.name}`,
            content: `<div style="padding:10px;">
                <label>归属派系</label>
                <select id="edit-n-f"
                    style="padding:6px; width:100%; margin-bottom:12px;
                           background:#222; color:#fff; border:1px solid #555;">
                    ${fOpts}
                    <option value="ind" ${oldFid === "ind" ? "selected" : ""}>
                        独立 NPC (无派系)
                    </option>
                </select>
                <div id="job-area">
                    <label>指派职位</label>
                    <select id="edit-n-j"
                        style="padding:6px; width:100%; background:#222;
                               color:#fff; border:1px solid #555;"></select>
                </div>
            </div>`,
            buttons: {
                save: {
                    label: "保存转移", icon: '<i class="fas fa-save"></i>',
                    callback: async (h) => {
                        const newFid = h.find("#edit-n-f").val();
                        const newJob = h.find("#edit-n-j").val();

                        if (oldFid === "ind") {
                            data.independent = data.independent.filter(n => n.id !== nid);
                        } else {
                            data.factions[oldFid].members = data.factions[oldFid].members.filter(n => n.id !== nid);
                        }

                        if (newFid === "ind") {
                            npc.title  = "";
                            npc.weight = 0;
                            data.independent.push(npc);
                        } else {
                            const job = (data.factions[newFid]?.jobs || []).find(j => j.name === newJob)
                                        ?? { name: "平民", weight: 2 };
                            npc.title  = job.name;
                            npc.weight = job.weight;
                            data.factions[newFid].members.push(npc);
                        }
    
                        await saveRepData(data);
                    refresh();
                    }
                }
            },
            render: (h) => {
                const updJ = () => {
                    const fid = h.find("#edit-n-f").val();
                    if (fid === "ind") {
                        h.find("#job-area").hide();
                    } else {
                        h.find("#job-area").show();
                        const jobs = data.factions[fid]?.jobs ?? [{ name: "平民", weight: 2 }];
                        h.find("#edit-n-j").html(
                            jobs.map(j =>
                                `<option value="${j.name}" ${j.name === npc.title ? "selected" : ""}>
                                    ${j.name} (权重:${j.weight})
                                </option>`
                            ).join("")
                        );
                    }
                };
                h.find("#edit-n-f").change(updJ);
                updJ();
            }
        }, { resizable: true }).render(true);
    });
    // ── 修改派系图标 ──────────────────────────────────────────
    html.find(".edit-f-img").click(e => {
        const fid = $(e.currentTarget).data("fid");
        new FilePicker({
            type:     "image",
            callback: async (p) => {
                data.factions[fid].img = p;
                await saveRepData(data);
                refresh();
            }
        }).browse();
    });

    // ── 删除NPC ───────────────────────────────────────────────
    html.find(".del-npc").click(async e => {
        const { nid, fid } = $(e.currentTarget).data();
        const npcObj = fid
            ? data.factions[fid]?.members.find(m => m.id === nid)
            : data.independent.find(m => m.id === nid);
        if (!npcObj) return;

        new Dialog({
            title: `删除确认`,
            content: `
            <div style="padding:12px; color:#eee; font-family:'Signika',sans-serif;">
                <p style="margin-top:0;">确定要删除 <b style="color:#e67e22;">${npcObj.name}</b> 吗？</p>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;
                    background:#2c3e50; padding:8px; border-radius:4px; border:1px solid #34495e;">
                    <input type="checkbox" id="del-with-data" checked
                        style="width:16px; height:16px; cursor:pointer;">
                    <span>一并删除对应数据（声望、任务，含共享任务中的目标引用）</span>
                </label>
            </div>`,
            buttons: {
                yes: {
                    label: '<i class="fas fa-trash"></i> 确认删除',
                    callback: async (h) => {
                        const withData = h.find("#del-with-data").is(":checked");

                        if (fid) data.factions[fid].members = data.factions[fid].members.filter(m => m.id !== nid);
                        else     data.independent            = data.independent.filter(m => m.id !== nid);
                        await saveRepData(data);

                        if (withData) {
                            const { getQuests, saveQuests } = await import("../data-manager.js");
                            const quests = await getQuests();
                            const filtered = quests.filter(q => {
                                if (q.npcId === nid) return false;
                                return true;
                            }).map(q => {
                                if (q.sharedWith?.includes(nid)) {
                                    q.sharedWith = q.sharedWith.filter(id => id !== nid);
                                }
                                return q;
                            });
                            await saveQuests(filtered);
                        }

                        refresh();
                    }
                },
                no: { label: "取消" }
            },
            default: "no"
        }, { width: 400 }).render(true);
    });

    // ── 录入新NPC ─────────────────────────────────────────────
    html.find(".add-npc-btn").click(() => {
        let selectedActor = null;
        const fOpts = data.factionOrder
            .map(id => `<option value="${id}">${data.factions[id].name}</option>`)
            .join("");

        new Dialog({
            title:   "录入角色至系统",
            content: `<div style="padding:10px; display:flex; flex-direction:column; gap:8px;">
                <input type="text" id="a-s" class="search-box" placeholder="输入关键字搜索生物...">
                <div id="a-r" class="actor-scroll"></div>
                <label>归属派系</label>
                <select id="n-f"
                    style="padding:6px; background:#222; color:#fff; border:1px solid #555;">
                    ${fOpts}
                    <option value="ind">独立 NPC（无派系）</option>
                </select>
                <div id="new-job-area">
                    <label>指派职位</label>
                    <select id="n-j"
                        style="padding:6px; width:100%; background:#222;
                               color:#fff; border:1px solid #555;"></select>
                </div>
            </div>`,
            buttons: {
                ok: {
                    label: "确认录入", icon: '<i class="fas fa-check"></i>',
                    callback: async (h) => {
                        if (!selectedActor) return ui.notifications.warn("请先选择一个生物");
                        const fid = h.find("#n-f").val();
                        const jn  = h.find("#n-j").val();
                        let job   = { name: "", weight: 0 };
                        if (fid !== "ind") {
                            job = (data.factions[fid]?.jobs || []).find(j => j.name === jn)
                                  ?? { name: "平民", weight: 2 };
                        }
                        const npc = {
                            id:       foundry.utils.randomID(),
                            actorId:  selectedActor.id,
                            name:     selectedActor.name,
                            img:      selectedActor.img,
                            title:    job.name,
                            weight:   job.weight,
                            affection: 0
                        };
                        if (fid === "ind") data.independent.push(npc);
                        else               data.factions[fid].members.push(npc);
                        await saveRepData(data);
                        refresh();
                    }
                },
                cancel: { label: "取消" }
            },
            render: (h) => {
                const updJ = () => {
                    const fid = h.find("#n-f").val();
                    if (fid === "ind") {
                        h.find("#new-job-area").hide();
                    } else {
                        h.find("#new-job-area").show();
                        const jobs = data.factions[fid]?.jobs ?? [{ name: "平民", weight: 2 }];
                        h.find("#n-j").html(
                            jobs.map(j =>
                                `<option value="${j.name}">${j.name} (权重:${j.weight})</option>`
                            ).join("")
                        );
                    }
                };
                h.find("#n-f").change(updJ);
                updJ();

                h.find("#a-s").on("input", e => {
                    const val = e.target.value.toLowerCase();
                    if (!val) { h.find("#a-r").empty(); return; }
                    const list = game.actors
                        .filter(a => a.name.toLowerCase().includes(val))
                        .slice(0, 15);
                    h.find("#a-r").html(
                        list.map(a => `
                            <div class="actor-opt" data-id="${a.id}">
                                <img src="${a.img}"
                                    style="width:24px; height:24px; border-radius:50%;
                                           vertical-align:middle; margin-right:8px; object-fit:cover;">
                                ${a.name}
                            </div>`
                        ).join("")
                    );
                    h.find(".actor-opt").click(ev => {
                        h.find(".actor-opt").removeClass("selected");
                        $(ev.currentTarget).addClass("selected");
                        selectedActor = game.actors.get($(ev.currentTarget).data("id"));
                    });
                });
            }
        }, { resizable: true }).render(true);
    });

    // ── 派系管理弹窗 ─────────────────────────────────────────
    html.find(".manage-f-btn").click(() => _openFactionManager(data, journal, refresh));
}

// ─── 派系管理子弹窗 ───────────────────────────────────────────
function _openFactionManager(data, journal, refresh) {
    const buildHTML = () => {
        return data.factionOrder.map(id => {
            const f          = data.factions[id];
            const isExpanded = _expandedSettingsFactions.includes(id);
            return `
            <div class="job-list-edit" data-fid="${id}">
                <div class="f-toggle"
                    style="display:flex; justify-content:space-between; align-items:center;
                           border-bottom:1px solid #444; padding-bottom:5px;
                           margin-bottom:8px; cursor:pointer;">
                    <b style="font-size:1.1em; color:#3498db; display:flex; align-items:center; flex:1;">
                        <div class="drag-handle" title="按住拖拽派系排序">
                            <i class="fas fa-grip-lines"></i>
                        </div>
                        <i class="fas ${isExpanded ? "fa-chevron-down" : "fa-chevron-right"} t-icon"
                           style="margin-right:5px; width:15px;"></i>
                        <span class="f-name-display" data-fid="${id}" style="cursor:default;">${f.name}</span>
                        <i class="fas fa-pen f-rename-btn" data-fid="${id}"
                           style="margin-left:6px; font-size:0.75em; color:#888; cursor:pointer;"
                           title="重命名派系"></i>
                    </b>
                    <a class="f-del-btn" data-fid="${id}"
                       style="color:#e74c3c; cursor:pointer;" title="彻底删除此派系">
                        <i class="fas fa-trash"></i>
                    </a>
                </div>
                <div class="f-edit-body" style="display:${isExpanded ? "block" : "none"}">
                    <div style="display:flex; gap:6px; color:#aaa; font-size:0.85em;
                         margin-bottom:4px; padding:0 4px;">
                        <span style="flex:1">职位名称</span>
                        <span style="width:65px; text-align:center;">权重</span>
                        <span style="width:28px"></span>
                    </div>
                    <div class="job-container">
                        ${(f.jobs || []).map(j => `
                            <div class="job-row">
                                <input type="text" class="j-n" value="${j.name}"
                                    placeholder="职位名称" style="flex:1">
                                <input type="number" class="j-w" value="${j.weight}"
                                    placeholder="权重" step="0.1" style="width:65px; text-align:center;">
                                <button class="j-del-btn"><i class="fas fa-times"></i></button>
                            </div>`
                        ).join("")}
                    </div>
                    <div style="display:flex; gap:6px; margin-top:8px;">
                        <button class="n-btn j-add-btn" style="flex:1;">
                            <i class="fas fa-plus"></i> 新增职位
                        </button>
                        <button class="n-btn j-sort-btn" style="flex:1; background:#2980b9;">
                            <i class="fas fa-sort-amount-down"></i> 排序
                        </button>
                    </div>
                </div>
            </div>`;
        }).join("") + `
        <hr style="border-color:#444;">
        <input type="text" id="new-f-n" placeholder="输入新派系名称"
            style="width:100%; padding:8px; background:#111; color:#fff;
                   border:1px solid #555; border-radius:3px; box-sizing:border-box;">
        <button class="n-btn" id="new-f-do"
            style="width:100%; margin-top:8px; background:#27ae60; padding:8px;">
            <i class="fas fa-flag"></i> 创建新派系
        </button>`;
    };

    const bindEvents = (h) => {
        bindDragAndDrop(h.find("#settings-f-container")[0], ".job-list-edit", ".drag-handle", () => {});

        h.find(".f-rename-btn").off("click").on("click", function (e) {
            e.stopPropagation();
            const fid  = $(this).data("fid");
            const span = h.find(`.f-name-display[data-fid="${fid}"]`);
            const old  = span.text().trim();
            const input = $(`<input type="text" value="${old}"
                style="background:#111;color:#fff;border:1px solid #3498db;
                       padding:2px 6px;border-radius:3px;font-size:1em;
                       width:120px;height:24px;">`);
            span.replaceWith(input);
            input.focus().select();

            const commit = async () => {
                const val = input.val().trim();
                const newName = val || old;
                if (data.factions[fid]) data.factions[fid].name = newName;
                await saveRepData(data);
                const newSpan = $(`<span class="f-name-display" data-fid="${fid}"
                    style="cursor:default;">${newName}</span>`);
                input.replaceWith(newSpan);
                h.find(`.f-rename-btn[data-fid="${fid}"]`).off("click").on("click", function (e2) {
                    e2.stopPropagation();
                    newSpan.trigger("dblclick");
                });
            };

            input.on("keydown", async (ev) => {
                if (ev.key === "Enter") { ev.preventDefault(); await commit(); }
                if (ev.key === "Escape") {
                    const revert = $(`<span class="f-name-display" data-fid="${fid}"
                        style="cursor:default;">${old}</span>`);
                    input.replaceWith(revert);
                }
            });
            input.on("blur", commit);
        });
        
        h.find(".f-toggle").off("click").click(function (e) {
            if ($(e.target).closest(".f-del-btn, .drag-handle").length) return;
            const fid        = $(this).closest(".job-list-edit").data("fid");
            const isExpanded = $(this).find(".t-icon").hasClass("fa-chevron-down");
            $(this).find(".t-icon").toggleClass("fa-chevron-down fa-chevron-right");
            $(this).next(".f-edit-body").slideToggle(200);
            if (isExpanded) _expandedSettingsFactions = _expandedSettingsFactions.filter(x => x !== fid);
            else            _expandedSettingsFactions.push(fid);
        });

        h.find("#new-f-do").off("click").click(async () => {
            const n = h.find("#new-f-n").val().trim();
            if (!n) return ui.notifications.warn("请输入派系名称");
            const nid = foundry.utils.randomID();
            data.factions[nid] = {
                name: n, img: "icons/svg/item-bag.svg", members: [],
                jobs: [{ name: "首领", weight: 10 }, { name: "平民", weight: 2 }]
            };
            data.factionOrder.push(nid);
            await saveRepData(data);
            ui.notifications.success("派系已创建！");
            h.find("#settings-f-container").html(buildHTML());
            bindEvents(h);
        });

        h.find(".j-add-btn").off("click").click(function () {
            $(this).parent().prev(".job-container").append(`
                <div class="job-row">
                    <input type="text"   class="j-n" placeholder="新职位" value="" style="flex:1">
                    <input type="number" class="j-w" placeholder="权重"   value="" step="0.1"
                        style="width:65px; text-align:center;">
                    <button class="j-del-btn"><i class="fas fa-times"></i></button>
                </div>`);
            h.find(".j-del-btn").off("click").on("click", function () { $(this).parent().remove(); });
        });

        h.find(".j-sort-btn").off("click").click(function () {
            const c    = $(this).parent().prev(".job-container");
            const rows = c.find(".job-row").get();
            rows.sort((a, b) =>
                (parseFloat($(b).find(".j-w").val()) || 0) -
                (parseFloat($(a).find(".j-w").val()) || 0)
            );
            rows.forEach(r => c.append(r));
        });

        h.find(".j-del-btn").off("click").click(function () { $(this).parent().remove(); });

        h.find(".f-del-btn").off("click").click(function () {
            const fid = $(this).data("fid");
            const fName = data.factions[fid]?.name || "未知派系";
            const memberCount = data.factions[fid]?.members?.length || 0;

            new Dialog({
                title: `删除派系确认`,
                content: `
                <div style="padding:12px; color:#eee; font-family:'Signika',sans-serif;">
                    <p style="margin-top:0;">确定要删除派系 <b style="color:#e67e22;">${fName}</b> 吗？
                    ${memberCount > 0 ? `（含 <b style="color:#e74c3c;">${memberCount}</b> 名成员）` : ""}</p>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;
                        background:#2c3e50; padding:8px; border-radius:4px; border:1px solid #34495e;">
                        <input type="checkbox" id="del-faction-with-data" checked
                            style="width:16px; height:16px; cursor:pointer;">
                        <span>一并删除派系下所有NPC的数据（声望、任务，含共享任务中的目标引用）</span>
                    </label>
                </div>`,
                buttons: {
                    yes: {
                        label: '<i class="fas fa-trash"></i> 确认删除',
                        callback: async (dh) => {
                            const withData = dh.find("#del-faction-with-data").is(":checked");
                            const members = data.factions[fid]?.members ?? [];

                            $(`.job-list-edit[data-fid="${fid}"]`).remove();
                            data.factions[`-=${fid}`] = null;
                            delete data.factions[fid];
                            data.factionOrder = data.factionOrder.filter(x => x !== fid);
                            await saveRepData(data);

                            if (withData && members.length > 0) {
                                const memberIds = members.map(m => m.id);
                                const { getQuests, saveQuests } = await import("../data-manager.js");
                                const quests = await getQuests();
                                const filtered = quests.filter(q => {
                                    if (memberIds.includes(q.npcId)) return false;
                                    return true;
                                }).map(q => {
                                    if (q.sharedWith?.some(id => memberIds.includes(id))) {
                                        q.sharedWith = q.sharedWith.filter(id => !memberIds.includes(id));
                                    }
                                    return q;
                                });
                                await saveQuests(filtered);
                            }

                            refresh();
                        }
                    },
                    no: { label: "取消" }
                },
                default: "no"
            }, { width: 420 }).render(true);
        });
    };

    new Dialog({
        title:   "派系与职位管理",
        content: `<div style="padding:10px; max-height:550px; overflow-y:auto; background:#222;"
                       id="settings-f-container">
            ${buildHTML()}
        </div>`,
        buttons: {
            save: {
                label: "保存更改并刷新", icon: '<i class="fas fa-check"></i>',
                callback: async (h) => {
                    const newOrder = [];
                    h.find(".job-list-edit").each(function () {
                        const fid = $(this).data("fid");
                        newOrder.push(fid);
                        if (!data.factions[fid]) return;
                        data.factions[fid].jobs = [];
                        $(this).find(".job-row").each(function () {
                            const jn    = $(this).find(".j-n").val().trim();
                            const jwStr = $(this).find(".j-w").val();
                            if (jn || jwStr !== "") {
                                data.factions[fid].jobs.push({
                                    name:   jn || "未命名",
                                    weight: jwStr !== "" ? parseFloat(jwStr) : 1.0
                                });
                            }
                        });
                    });
                    data.factionOrder = newOrder;
                    await saveRepData(data);
                    refresh();
                }
            },
            cancel: { label: "取消" }
        },
        render: (h) => bindEvents(h)
    }, { width: 480, resizable: true }).render(true);
}