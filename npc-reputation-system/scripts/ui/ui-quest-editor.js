/**
 * ui-quest-editor.js
 * 任务编辑器：添加/编辑/复制任务，阶段配置
 */

import { saveRepData }        from "../data-manager.js";
import { getWorldTimeString } from "../utils.js";

let _currentEditPhases      = [];
let _currentEditTargets     = [];
let _currentExternalShares  = [];

// ─── 静态 HTML 生成 ───────────────────────────────────────────

export function buildQuestEditorHTML(
    systemPresets, factionMembers, targetOptions, shareCbsHtml
) {
    const presetBtns = systemPresets.map(p =>
        `<button type="button" class="pre-btn apply-preset"
            data-req="${p.req || 0}" data-gold="${p.gold}"
            data-pos="${p.pos}" data-neg="${p.neg}">
            ${p.name}
         </button>`
    ).join("");

    return `
    <div style="display:flex;justify-content:space-between;align-items:center;
         margin-bottom:12px;background:rgba(0,0,0,0.3);padding:8px 10px;
         border-radius:4px;border:1px solid #333;">
        <div style="display:flex;align-items:center;gap:8px;
             flex-wrap:wrap;flex:1;">
            <div style="font-size:0.9em;color:#aaa;font-weight:bold;
                 display:flex;align-items:center;white-space:nowrap;">
                <i class="fas fa-magic"
                   style="margin-right:4px;color:#f1c40f;"></i>
                奖励预设
            </div>
            ${presetBtns}
        </div>
        <button type="button" class="q-btn act-copy-quests"
            style="flex:none;width:auto;height:28px;background:#8e44ad;
                   border-color:#9b59b6;display:flex;align-items:center;
                   gap:6px;padding:0 10px;border-radius:4px;
                   margin:0 0 0 10px;font-size:0.85em;">
            <i class="fas fa-file-import"></i>
            <span style="font-weight:bold;">从其他NPC导入任务</span>
        </button>
    </div>

    <input type="hidden" id="edit-q-id" value="">

    <label style="color:#ccc;">任务名称</label>
    <input type="text" id="edit-q-name"
        style="width:100%;height:32px;background:#111;color:#fff;
               border:1px solid #555;padding:0 8px;
               box-sizing:border-box;margin-bottom:8px;">

    <div style="display:flex;gap:12px;align-items:flex-end;">
        <div style="flex:1;">
            <label style="color:#ccc;">解锁门槛（声望）</label>
            <input type="number" id="edit-q-min"
                style="width:100%;height:32px;background:#111;color:#fff;
                       border:1px solid #555;padding:0 8px;
                       box-sizing:border-box;">
        </div>
        <label class="edit-q-cb-wrap">
            <input type="checkbox" id="edit-q-ignore"> 无视门槛
        </label>
        <div style="flex:1.2;">
            <label style="color:#ccc;">任务时限</label>
            <input type="text" id="edit-q-timeLimit"
                style="width:100%;height:32px;background:#111;color:#fff;
                       border:1px solid #555;padding:0 8px;
                       box-sizing:border-box;">
        </div>
    </div>

    <!-- 共享区块 -->
    <div style="background:rgba(52,152,219,0.1);padding:10px;
         border-radius:4px;margin-top:15px;border:1px solid #2980b9;">
        <div style="display:flex;justify-content:space-between;
             align-items:center;cursor:pointer;"
             id="toggle-share-section">
            <label style="color:#3498db;font-weight:bold;margin:0;
                cursor:pointer;width:100%;">
                <i class="fas fa-share-alt"></i> 共享任务 / 添加交付人
                <i class="fas fa-chevron-down" id="share-chevron"
                   style="margin-left:5px;font-size:0.85em;"></i>
            </label>
        </div>
        <div id="share-content-wrapper"
             style="display:none;margin-top:10px;
                    border-top:1px dashed #444;padding-top:10px;">
            <div style="display:flex;gap:15px;align-items:flex-start;">
                <div style="flex:1;border-right:1px dashed #444;
                     padding-right:15px;">
                    <div style="display:flex;justify-content:space-between;
                         align-items:center;margin-bottom:6px;">
                        <span style="color:#3498db;font-size:0.9em;
                            font-weight:bold;">派系内共享</span>
                        <button type="button" class="q-btn"
                            id="btn-select-all-share"
                            style="flex:none;width:auto;height:24px;
                                   padding:0 8px;margin:0;font-size:0.8em;
                                   background:#2980b9;border-color:#3498db;">
                            全选/反选
                        </button>
                    </div>
                    <div style="font-size:0.8em;color:#aaa;margin-bottom:8px;">
                        同派系任务板可见，可代为结算。
                    </div>
                    <div id="edit-q-share-cbs"
                         style="display:flex;flex-wrap:wrap;gap:6px;">
                        ${shareCbsHtml}
                    </div>
                </div>
                <div style="flex:1;">
                    <div style="display:flex;justify-content:space-between;
                         align-items:center;margin-bottom:6px;">
                        <span style="color:#9b59b6;font-size:0.9em;
                            font-weight:bold;">跨派系NPC交付</span>
                        <button type="button" class="q-btn"
                            id="btn-add-external-share"
                            style="flex:none;width:auto;height:24px;
                                   padding:0 8px;margin:0;font-size:0.8em;
                                   background:#8e44ad;border-color:#9b59b6;">
                            + 添加NPC
                        </button>
                    </div>
                    <div style="font-size:0.8em;color:#aaa;margin-bottom:8px;">
                        允许指定的外部NPC作为任务交付人。
                    </div>
                    <div id="external-share-tags"
                         style="display:flex;flex-wrap:wrap;gap:6px;"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- 周期发薪 -->
    <div style="background:rgba(230,126,34,0.1);padding:10px;
         border-radius:4px;margin-top:15px;border:1px solid #d35400;">
        <label class="edit-q-cb-wrap"
            style="color:#e67e22;font-weight:bold;margin-top:0;">
            <input type="checkbox" id="edit-q-periodic">
            开启长线多阶段/周期发薪模式
        </label>
        <div id="periodic-settings" style="display:none;margin-top:8px;">
            <div style="display:flex;align-items:center;
                 gap:10px;margin-bottom:10px;">
                <label style="margin:0;color:#ccc;">
                    自动发薪间隔（天，0为仅阶段结算不发薪）
                </label>
                <input type="number" id="edit-q-period" value="7"
                    style="width:80px;background:#111;color:#fff;
                           border:1px solid #555;padding:0 8px;height:32px;">
            </div>
        </div>
    </div>

    <!-- 阶段配置 -->
    <div style="display:flex;justify-content:space-between;
         align-items:center;border-bottom:1px solid #444;
         padding-bottom:5px;margin-top:15px;">
        <label style="font-weight:bold;font-size:1.1em;margin:0;">
            详细阶段配置
        </label>
    </div>
    <div id="phase-list-container" style="padding-top:15px;"></div>
    <button class="q-btn" id="act-add-phase"
        style="width:100%;margin-top:5px;background:#2980b9;">
        <i class="fas fa-plus"></i> 添加新阶段
    </button>

    <!-- 分配目标 -->
    <label style="margin-top:15px;display:block;color:#ccc;">
        分配目标
    </label>
    <div style="display:flex;gap:5px;margin-bottom:5px;">
        <select id="edit-q-target-sel" style="flex:1;">
            ${targetOptions}
        </select>
        <button class="q-btn accept" id="act-add-target"
            style="flex:0 0 70px;height:36px;padding:0;">
            <i class="fas fa-plus"></i> 添加
        </button>
    </div>
    <div id="edit-q-target-tags"
        style="display:flex;gap:6px;flex-wrap:wrap;min-height:40px;
               background:#111;border:1px solid #444;padding:8px;
               border-radius:4px;margin-bottom:10px;"></div>

    <!-- 保存/取消 -->
    <div style="display:flex;gap:10px;margin-top:18px;">
        <button class="q-btn accept" id="act-save-quest"
            style="flex:2;padding:10px;font-size:1em;">
            <i class="fas fa-save"></i> 存入任务库
        </button>
        <button class="q-btn fail" id="act-cancel-edit"
            style="display:none;flex:1;padding:10px;font-size:1em;">
            <i class="fas fa-times"></i> 取消编辑
        </button>
    </div>`;
}

// ─── 阶段列表渲染 ─────────────────────────────────────────────

export function renderPhases(html) {
    const htmlStr = _currentEditPhases.length === 0
        ? `<div style="text-align:center;color:#777;padding:10px;
               font-style:italic;">请至少添加一个阶段</div>`
        : _currentEditPhases.map((p, i) => `
            <div class="phase-block">
                <div style="position:absolute;top:-10px;left:10px;
                     background:#3498db;color:#fff;font-size:0.8em;
                     font-weight:bold;padding:2px 8px;border-radius:3px;">
                     第 ${i + 1} 阶段
                </div>
                <button class="q-btn fail del-phase" data-idx="${i}"
                    style="position:absolute;top:5px;right:5px;
                           width:24px;height:24px;padding:0;">
                    <i class="fas fa-times"></i>
                </button>
                <textarea class="ep-desc" rows="2"
                    placeholder="阶段详情描述..."
                    style="width:100%;background:#000;color:#fff;
                           border:1px solid #555;padding:6px;
                           margin-top:10px;margin-bottom:8px;
                           border-radius:3px;resize:vertical;
                           font-family:inherit;">
                    ${p.desc || ""}</textarea>
                <div style="display:flex;gap:4px;margin-bottom:8px;
                     align-items:center;flex-wrap:nowrap;overflow:hidden;">
                    <label style="color:#f1c40f;margin:0;white-space:nowrap;">
                        <i class="fas fa-coins"></i> 报酬
                    </label>
                    <input type="number" class="ep-gold"
                        value="${p.goldNum || ""}"
                        style="width:60px;background:#000;
                               border:1px solid #555;color:#fff;
                               padding:4px 2px;text-align:center;">
                    <select class="ep-gold-t"
                        style="height:28px;background:#111;color:#fff;
                               border:1px solid #555;padding:0 2px;">
                        <option value="gp">gp</option>
                        <option value="sp">sp</option>
                        <option value="cp">cp</option>
                        <option value="pp">pp</option>
                    </select>
                    <label style="color:#2ecc71;margin:0;
                        white-space:nowrap;">
                        <i class="fas fa-heart"></i> 完成+
                    </label>
                    <input type="number" class="ep-pos"
                        value="${p.posAff || ""}"
                        style="width:40px;background:#000;
                               border:1px solid #555;color:#fff;
                               padding:4px 2px;text-align:center;">
                    <label style="color:#e74c3c;margin:0;
                        white-space:nowrap;">
                        <i class="fas fa-heart-broken"></i> 失败-
                    </label>
                    <input type="number" class="ep-neg"
                        value="${p.negAff || ""}"
                        style="width:40px;background:#000;
                               border:1px solid #555;color:#fff;
                               padding:4px 2px;text-align:center;">
                </div>
                <input type="text" class="ep-items drop-zone"
                    value="${p.items || ""}"
                    placeholder="拖拽物品至此（后缀加 x2 表数量）..."
                    style="width:100%;background:#000;
                           border:2px dashed #555;color:#fff;
                           padding:6px;border-radius:3px;">
            </div>`
        ).join("");

    html.find("#phase-list-container").html(htmlStr);

    html.find("#phase-list-container .phase-block").each(function (i) {
        $(this).find(".ep-gold-t").val(
            _currentEditPhases[i]?.goldType || "gp");
        // useScale 固定 false，不再有 checkbox
    });

    _bindPhaseEvents(html);
}

function _bindPhaseEvents(html) {
    html.find(".del-phase").off("click").click(function () {
        _currentEditPhases.splice($(this).data("idx"), 1);
        renderPhases(html);
    });

    html.find(".ep-desc, .ep-gold, .ep-pos, .ep-neg, .ep-items")
        .off("change").on("change", function () {
            const block = $(this).closest(".phase-block");
            const i     = block.find(".del-phase").data("idx");
            _currentEditPhases[i] = {
                desc:    block.find(".ep-desc").val(),
                goldNum: parseInt(block.find(".ep-gold").val())  || 0,
                goldType:block.find(".ep-gold-t").val()          || "gp",
                useScale:false,   // 固定关闭
                posAff:  parseInt(block.find(".ep-pos").val())   || 0,
                negAff:  parseInt(block.find(".ep-neg").val())   || 0,
                items:   block.find(".ep-items").val()
            };
        });

    // 物品拖拽
    html.find(".ep-items").each(function () {
        this.addEventListener("dragover", e => {
            e.preventDefault();
            $(this).addClass("dragover");
        });
        this.addEventListener("dragleave", () =>
            $(this).removeClass("dragover"));
        this.addEventListener("drop", e => {
            e.preventDefault();
            $(this).removeClass("dragover");
            try {
                const d = JSON.parse(
                    e.dataTransfer.getData("text/plain"));
                if (d?.type === "Item") {
                    const name  = d.name ||
                        fromUuidSync(d.uuid)?.name || d.uuid;
                    const toAdd = `@UUID[${d.uuid}]{${name}}`;
                    const old   = $(this).val().trim();
                    const sep   = old && !old.endsWith(",") ? ", " : "";
                    $(this).val(old + sep + toAdd).trigger("change");
                }
            } catch (err) { /* 忽略 */ }
        });
    });
}

// ─── 目标标签 ─────────────────────────────────────────────────

export function renderTargetTags(html) {
    const htmlStr = _currentEditTargets.length === 0
        ? `<span style="color:#777;font-size:0.95em;padding:4px;">
               请添加至少一个目标…</span>`
        : _currentEditTargets.map(t => `
            <span class="q-target-tag" data-id="${t.id}"
                style="background:#2980b9;padding:4px 8px;
                       border-radius:4px;font-size:0.95em;
                       display:inline-flex;align-items:center;gap:6px;">
                ${t.name}
                <i class="fas fa-times remove-target"
                   style="cursor:pointer;color:#ffcccc;"
                   title="移除"></i>
            </span>`
        ).join("");

    html.find("#edit-q-target-tags").html(htmlStr);
    html.find(".remove-target").off("click").click(function () {
        const id = $(this).parent().data("id");
        _currentEditTargets = _currentEditTargets.filter(t => t.id !== id);
        renderTargetTags(html);
    });
}

// ─── 跨派系共享标签 ───────────────────────────────────────────

export function renderExternalShareTags(html) {
    const tagsHtml = _currentExternalShares.length === 0
        ? `<span style="color:#777;font-size:0.85em;">无额外共享NPC</span>`
        : _currentExternalShares.map(t => `
            <span class="external-share-tag" data-id="${t.id}"
                style="background:#8e44ad;padding:2px 6px;
                       border-radius:3px;font-size:0.85em;
                       display:inline-flex;align-items:center;
                       gap:4px;color:#fff;">
                ${t.name}
                <i class="fas fa-times remove-ext-share"
                   style="cursor:pointer;color:#ffcccc;"
                   title="移除"></i>
            </span>`
        ).join("");

    html.find("#external-share-tags").html(tagsHtml);
    html.find(".remove-ext-share").off("click").click(function () {
        const id = $(this).parent().data("id");
        _currentExternalShares =
            _currentExternalShares.filter(t => t.id !== id);
        renderExternalShareTags(html);
    });
}

// ─── 填入表单 ─────────────────────────────────────────────────

export function fillForm(html, q, factionMembers, allNpcsRaw) {
    html.find("#edit-q-id").val(q?.id ?? "");
    html.find("#edit-q-name").val(q?.name ?? "");
    html.find("#edit-q-min").val(q?.minAff ?? "");
    html.find("#edit-q-timeLimit").val(q?.timeLimit ?? "");
    html.find("#edit-q-ignore").prop("checked", q?.ignoreAff ?? false);
    html.find("#edit-q-periodic")
        .prop("checked", q?.isPeriodic ?? false).trigger("change");
    html.find("#edit-q-period").val(q?.periodDays ?? 7);

    if (q?.phases?.length > 0) {
        _currentEditPhases = foundry.utils.duplicate(q.phases);
        // 强制关闭所有阶段的 useScale
        _currentEditPhases.forEach(p => { p.useScale = false; });
    } else if (q) {
        _currentEditPhases = [{
            desc:     q.desc,
            goldNum:  q.goldNum,
            goldType: q.goldType || "gp",
            useScale: false,
            posAff:   q.posAff,
            negAff:   q.negAff,
            items:    q.items
        }];
    } else {
        _currentEditPhases = [{
            desc: "", goldNum: 0, goldType: "gp",
            useScale: false, posAff: 0, negAff: 0, items: ""
        }];
    }
    renderPhases(html);

    if (q?.targetId) {
        const ids   = q.targetId.split(",");
        const names = (q.targetName || "").split(", ");
        _currentEditTargets = ids.map((id, idx) => ({
            id, name: names[idx] || id
        }));
    } else {
        const defaultOpt = html.find("#edit-q-target-sel option:first");
        _currentEditTargets = [{
            id:   defaultOpt.val(),
            name: defaultOpt.text().replace(/👤 |👥 /g, "").trim()
        }];
    }
    renderTargetTags(html);

    _currentExternalShares = [];
    let sharedIds = q ? [...(q.sharedWith || [])] : [];
    html.find(".share-cb").each(function () {
        const id        = $(this).val();
        const isChecked = sharedIds.includes(id);
        $(this).prop("checked", isChecked);
        if (isChecked) sharedIds = sharedIds.filter(x => x !== id);
    });
    for (const exId of sharedIds) {
        const n = allNpcsRaw.find(x => x.id === exId);
        if (n) _currentExternalShares.push({ id: exId, name: n.name });
    }
    renderExternalShareTags(html);

    html.find("#act-cancel-edit").css("display", q ? "block" : "none");
}

// ─── 读取表单当前值 ───────────────────────────────────────────

export function getCurrentFormData(html) {
    const sharedWith = [];
    html.find(".share-cb:checked").each(function () {
        sharedWith.push($(this).val());
    });
    _currentExternalShares.forEach(t => sharedWith.push(t.id));

    return {
        id:         html.find("#edit-q-id").val(),
        name:       html.find("#edit-q-name").val(),
        minAff:     parseInt(html.find("#edit-q-min").val()) || 0,
        ignoreAff:  html.find("#edit-q-ignore").is(":checked"),
        timeLimit:  html.find("#edit-q-timeLimit").val(),
        isPeriodic: html.find("#edit-q-periodic").is(":checked"),
        periodDays: parseInt(html.find("#edit-q-period").val()) || 7,
        useScale:   false,   // 全局关闭
        goldType:   _currentEditPhases[0]?.goldType || "gp",
        targetId:   _currentEditTargets.map(t => t.id).join(","),
        targetName: _currentEditTargets.map(t => t.name).join(", "),
        phases:     _currentEditPhases.map(p => ({ ...p, useScale: false })),
        sharedWith: [...new Set(sharedWith)]
    };
}

// ─── 绑定编辑区事件 ───────────────────────────────────────────

export function bindQuestEditorEvents(html, context) {

    html.find("#toggle-share-section").off("click").on("click", function () {
        const wrapper = html.find("#share-content-wrapper");
        const chevron = html.find("#share-chevron");
        if (wrapper.is(":visible")) {
            wrapper.slideUp(150);
            chevron.removeClass("fa-chevron-up").addClass("fa-chevron-down");
        } else {
            wrapper.slideDown(150);
            chevron.removeClass("fa-chevron-down").addClass("fa-chevron-up");
        }
    });

    html.find("#btn-select-all-share").off("click").on("click", function (e) {
        e.preventDefault();
        const cbs       = html.find(".share-cb");
        const allChecked = cbs.length > 0 &&
            cbs.length === cbs.filter(":checked").length;
        cbs.prop("checked", !allChecked);
    });

    html.find("#btn-add-external-share").off("click").on("click", () => {
        const optHtml = context.allNpcsRaw
            .filter(n =>
                n.id !== context.targetNPC.id &&
                !context.factionMembers.find(f => f.id === n.id))
            .map(n => `<option value="${n.id}">${n.name}</option>`)
            .join("");

        if (!optHtml)
            return ui.notifications.warn("没有其他可用的NPC了！");

        // 这个子弹窗需要高 z-index
        const d = new Dialog({
            title:   "选择可交付的其他NPC",
            content: `<div style="padding:10px;">
                <select id="ext-share-sel"
                    style="width:100%;height:36px;background:#111;
                           color:#fff;border:1px solid #555;">
                    ${optHtml}
                </select>
            </div>`,
            buttons: {
                add: {
                    label: "确认添加",
                    icon:  '<i class="fas fa-plus"></i>',
                    callback: (dh) => {
                        const tid  = dh.find("#ext-share-sel").val();
                        const tNpc = context.allNpcsRaw.find(
                            n => n.id === tid);
                        if (tNpc && !_currentExternalShares.find(
                            x => x.id === tid)) {
                            _currentExternalShares.push({
                                id: tid, name: tNpc.name
                            });
                            renderExternalShareTags(html);
                        }
                    }
                }
            }
        });
        d.render(true);
        // 渲染后强制提高 z-index
        d._render(true).then(() => {
            d.element?.css("z-index", "10100");
        });
    });

    html.find("#edit-q-periodic").change(function () {
        html.find("#periodic-settings").toggle(this.checked);
    });

    html.find("#act-add-phase").click(() => {
        _currentEditPhases.push({
            desc: "", goldNum: 0, goldType: "gp",
            useScale: false, posAff: 0, negAff: 0, items: ""
        });
        renderPhases(html);
    });

    html.find("#act-add-target").click(() => {
        const sel   = html.find("#edit-q-target-sel");
        const tId   = sel.val();
        const tName = sel.find("option:selected").text()
                          .replace(/👤 |👥 /g, "").trim();
        if (_currentEditTargets.find(t => t.id === tId)) return;

        const isGroup = tId === "ALL" ||
            game.actors.get(tId)?.type.match(/party|group/i);

        if (isGroup) {
            _currentEditTargets = [{ id: tId, name: tName }];
        } else {
            _currentEditTargets = _currentEditTargets.filter(
                t => t.id !== "ALL" &&
                !game.actors.get(t.id)?.type.match(/party|group/i));
            _currentEditTargets.push({ id: tId, name: tName });
        }
        renderTargetTags(html);
    });
    
    html.find("#act-cancel-edit").off("click").on("click", () => {
        fillForm(html, null, context.factionMembers, context.allNpcsRaw);
        html.find("#quest-editor-inline").slideUp(150);
    });

    html.find(".apply-preset").click(function () {
        if (_currentEditPhases.length === 0)
            return ui.notifications.warn("请先添加一个阶段");
        html.find("#edit-q-min").val($(this).data("req") || 0);
        _currentEditPhases[0].goldNum = $(this).data("gold");
        _currentEditPhases[0].posAff  = $(this).data("pos");
        _currentEditPhases[0].negAff  = $(this).data("neg");
        renderPhases(html);
        ui.notifications.info(`已载入预设：${$(this).text()}`);
    });

    html.find(".act-copy-quests").click(() => {
        const optHtml = context.allNpcsRaw
            .filter(n => n.id !== context.targetNPC.id)
            .map(n => `<option value="${n.id}">${n.name}</option>`)
            .join("");

        const d = new Dialog({
            title:   "从其他 NPC 导入任务",
            content: `
            <div style="padding:10px;background:#111;color:#eee;
                 box-sizing:border-box;">
                <select id="copy-source-sel"
                    style="width:100%;height:36px;background:#222;
                           color:#fff;border:1px solid #555;">
                    <option value="">-- 选择源 NPC --</option>
                    ${optHtml}
                </select>
                <div id="copy-q-list"
                     style="margin-top:10px;max-height:400px;
                            overflow-y:auto;padding-right:5px;"></div>
            </div>`,
            buttons: { cancel: { label: "关闭窗口" } },
            render: (h) => {
                h.find("#copy-source-sel").change(function () {
                    const sid = $(this).val();
                    if (!sid) { h.find("#copy-q-list").empty(); return; }
                    const sQs = context.questsData.filter(
                        x => x.npcId === sid);
                    if (sQs.length === 0) {
                        h.find("#copy-q-list").html(
                            '<div style="color:#777;text-align:center;' +
                            'padding:10px;">该 NPC 暂无任务。</div>');
                        return;
                    }
                    h.find("#copy-q-list").html(sQs.map(q => `
                        <div style="display:flex;justify-content:space-between;
                             align-items:center;padding:8px;background:#1a1a1a;
                             margin-bottom:5px;border-radius:4px;
                             border:1px solid #444;">
                            <span style="font-weight:bold;color:#3498db;
                                flex:1;white-space:nowrap;overflow:hidden;
                                text-overflow:ellipsis;"
                                title="${q.name}">${q.name}</span>
                            <button type="button"
                                class="q-btn do-copy-btn"
                                data-qid="${q.id}"
                                style="flex:none;width:auto;
                                       background:#27ae60;
                                       padding:4px 10px;
                                       border-color:#2ecc71;margin:0;">
                                <i class="fas fa-download"></i> 载入表单
                            </button>
                        </div>`
                    ).join(""));

                    h.find(".do-copy-btn").off("click").click(function (e) {
                        e.preventDefault();
                        const srcQ = context.questsData.find(
                            x => x.id === $(this).data("qid"));
                        if (srcQ) {
                            const newQ        = foundry.utils.duplicate(srcQ);
                            newQ.id           = "";
                            newQ.npcId        = context.targetNPC.id;
                            newQ.status       = "avail";
                            newQ.timeAccept   = null;
                            newQ.timeComplete = null;
                            newQ.timeFail     = null;
                            newQ.lastPayTime  = null;
                            newQ.payHistory   = [];
                            newQ.sharedWith   = [];
                            // 关闭浮动
                            if (newQ.phases)
                                newQ.phases.forEach(p => {
                                    p.useScale = false;
                                });
                            newQ.useScale = false;
                            fillForm(html, newQ,
                                context.factionMembers, context.allNpcsRaw);
                            ui.notifications.success(
                                `已将任务【${newQ.name}】载入表单！`);
                            h.closest(".dialog").remove();
                        }
                    });
                });
            }
        }, { width: 500, height: "auto" });
        d.render(true);
        d._render(true).then(() => {
            d.element?.css("z-index", "10100");
        });
    });
}