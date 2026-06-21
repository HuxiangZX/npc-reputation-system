/**
 * ui-linkage-settings.js
 * 派系声望联动设置面板（从宏2拆分）
 */

import { saveRepData } from "../data-manager.js";

/**
 * 打开联动设置面板
 * @param {object}   targetNPC      - 当前NPC对象（引用，修改后直接生效）
 * @param {string}   targetFactionId
 * @param {Array}    factionMembers - 同派系其他成员数组
 * @param {object}   repData        - 完整repData（用于读写全局设置）
 */
export function openLinkageSettings(targetNPC, targetFactionId, factionMembers, repData) {
    const npcOpts = factionMembers
        .map(m => `<option value="${m.id}">${m.name} (权重:${m.weight ?? 1})</option>`)
        .join("");

    // ── 渲染权重规则列表 ──────────────────────────────────────
    const renderRules = (h) => {
        const rules  = targetNPC.repLink?.rules ?? [];
        const rHtml  = rules.length === 0
            ? `<div style="color:#777; font-size:0.85em; text-align:center; padding:5px;">
                   暂无权重规则
               </div>`
            : rules.map((r, i) => `
                <div class="link-rule-row"
                    style="display:flex; gap:6px; margin-bottom:6px; align-items:center;
                           background:#111; padding:6px; border-radius:4px; border:1px solid #333;">
                    <span style="color:#aaa; font-size:0.9em;">权重:</span>
                    <input type="number" step="0.1" class="lr-min" value="${r.min}"
                        style="width:50px; height:28px; background:#000; color:#fff;
                               border:1px solid #555; text-align:center; padding:0;">
                    <span style="color:#aaa;">~</span>
                    <input type="number" step="0.1" class="lr-max" value="${r.max}"
                        style="width:50px; height:28px; background:#000; color:#fff;
                               border:1px solid #555; text-align:center; padding:0;">
                    <span style="color:#aaa; font-size:0.9em; margin-left:4px;">倍率:</span>
                    <input type="number" step="0.1" class="lr-mult" value="${r.mult}"
                        style="flex:1; min-width:0; height:28px; background:#000; color:#fff;
                               border:1px solid #555; text-align:center; padding:0;">
                    <button type="button" class="q-btn fail lr-del" data-idx="${i}"
                        style="flex:none; width:30px; height:28px; padding:0; margin:0;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>`
            ).join("");

        h.find("#rules-container").html(rHtml);

        h.find(".lr-min, .lr-max, .lr-mult").off("change").on("change", function () {
            const row = $(this).closest(".link-rule-row");
            const idx = row.find(".lr-del").data("idx");
            targetNPC.repLink.rules[idx] = {
                min:  parseFloat(row.find(".lr-min").val())  || 0,
                max:  parseFloat(row.find(".lr-max").val())  || 0,
                mult: parseFloat(row.find(".lr-mult").val()) || 0
            };
        });

        h.find(".lr-del").off("click").on("click", function (e) {
            e.preventDefault();
            targetNPC.repLink.rules.splice($(this).data("idx"), 1);
            renderRules(h);
        });
    };

    // ── 渲染特殊接收规则 ──────────────────────────────────────
    const renderSpecRules = (h) => {
        const ignores = targetNPC.repLink?.ignores ?? {};
        const sHtml   = Object.keys(ignores).length === 0
            ? `<div style="color:#777; font-size:0.85em; text-align:center; padding:8px 0;">
                   暂无特定来源规则
               </div>`
            : Object.entries(ignores).map(([sId, mult]) => {
                const member = factionMembers.find(m => m.id === sId);
                const sName  = member
                    ? `${member.name} (权重:${member.weight ?? 1})`
                    : "未知NPC";
                return `
                <div class="spec-rule-row"
                    style="display:flex; justify-content:space-between; align-items:center;
                           background:#111; padding:6px 10px; margin-bottom:6px;
                           border-radius:4px; border:1px solid #333;">
                    <span style="font-size:0.95em; color:#ddd; flex:1; white-space:nowrap;
                        overflow:hidden; text-overflow:ellipsis;" title="${sName}">
                        ${sName}
                    </span>
                    <div style="display:flex; gap:6px; align-items:center; flex:none;">
                        <input type="number" step="0.1" class="sr-mult"
                            data-id="${sId}" value="${mult}"
                            style="width:50px; height:26px; background:#000; color:#fff;
                                   border:1px solid #555; text-align:center;
                                   padding:0; margin:0;" title="倍率">
                        <button type="button" class="q-btn fail sr-del"
                            data-id="${sId}"
                            style="width:26px; height:26px; padding:0; margin:0;
                                   min-width:0; display:flex; align-items:center;
                                   justify-content:center;" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
            }).join("");

        h.find("#spec-rules-container").html(sHtml);

        h.find(".sr-del").off("click").on("click", function (e) {
            e.preventDefault();
            delete targetNPC.repLink.ignores[$(this).data("id")];
            renderSpecRules(h);
        });
        h.find(".sr-mult").off("change").on("change", function () {
            targetNPC.repLink.ignores[$(this).data("id")] =
                parseFloat($(this).val()) || 0;
        });
    };

    // ── 构建并渲染对话框 ──────────────────────────────────────
    const fl = repData.settings.factionLink;

    new Dialog({
        title:   `联动设置: ${targetNPC.name}`,
        content: `
        <div style="padding:10px; background:#111; color:#eee; box-sizing:border-box;">

            <!-- 全局开关 -->
            <div style="background:#222; padding:10px; border:1px solid #444;
                 border-radius:4px; margin-bottom:10px;">
                <h4 style="margin:0 0 10px 0; color:#e67e22;">🌍 全局派系联动开关</h4>
                <label style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="gl-link-en" ${fl.enabled ? "checked" : ""}>
                    启用同派系好感连带响应
                </label>
                <div style="margin-top:8px; display:flex; gap:10px; align-items:center;">
                    <label>触发最低阈值（单次变动）：</label>
                    <input type="number" id="gl-link-th" value="${fl.threshold}"
                        style="width:60px; background:#000; color:#fff;
                               padding:2px 6px; border:1px solid #555;">
                </div>
            </div>

            <!-- NPC个体规则 -->
            <div style="background:#222; padding:10px; border:1px solid #444;
                 border-radius:4px; margin-bottom:5px;">
                <h4 style="margin:0 0 10px 0; color:#3498db;">👤 当前NPC专属个体规则</h4>

                <label style="display:block; margin-bottom:5px;">参与模式：</label>
                <select id="npc-link-mode"
                    style="width:100%; height:32px; background:#000; color:#fff;
                           border:1px solid #555; margin-bottom:10px; padding:0 4px;">
                    <option value="1" ${targetNPC.repLink?.mode === 1 ? "selected" : ""}>
                        双向（传递给别人，也接收别人）
                    </option>
                    <option value="2" ${targetNPC.repLink?.mode === 2 ? "selected" : ""}>
                        仅发送（影响别人，不被影响）
                    </option>
                    <option value="3" ${targetNPC.repLink?.mode === 3 ? "selected" : ""}>
                        仅接收（被别人影响，不影响别人）
                    </option>
                    <option value="0" ${targetNPC.repLink?.mode === 0 ? "selected" : ""}>
                        关闭（完全孤立）
                    </option>
                </select>

                <div style="display:flex; gap:10px; align-items:center;">
                    <label>作为接收方时，个人基础接收倍率：</label>
                    <input type="number" step="0.1" id="npc-link-mult"
                        value="${targetNPC.repLink?.mult ?? 1.0}"
                        style="width:60px; background:#000; color:#fff;
                               border:1px solid #555; padding:2px 6px;">
                </div>

                <!-- 广播权重倍率表 -->
                <div style="margin-top:12px; border-top:1px dashed #555; padding-top:10px;">
                    <label style="display:block; margin-bottom:8px; color:#3498db;">
                        <i class="fas fa-broadcast-tower"></i>
                        作为发送方时，向外广播的权重倍率表
                    </label>
                    <div id="rules-container"
                        style="max-height:150px; overflow-y:auto;
                               padding-right:5px; margin-bottom:8px;"></div>
                    <button type="button" class="q-btn" id="add-lr"
                        style="width:100%; height:32px; background:#333;
                               color:#eee; border:1px solid #555;">
                        <i class="fas fa-plus"></i> 新增权重区间
                    </button>
                </div>

                <!-- 特殊接收倍率 -->
                <div style="margin-top:12px; border-top:1px dashed #555; padding-top:10px;">
                    <label style="display:block; margin-bottom:8px; color:#e74c3c;">
                        <i class="fas fa-ban"></i>
                        针对特定成员的特殊接收倍率（设为0即屏蔽）
                    </label>
                    <div id="spec-rules-container"
                        style="max-height:150px; overflow-y:auto;
                               padding-right:5px; margin-bottom:10px;"></div>
                    <div style="display:flex; gap:6px; align-items:center;
                         width:100%; box-sizing:border-box;">
                        <select id="spec-npc-sel"
                            style="flex:1; min-width:0; height:32px; background:#000;
                                   color:#fff; border:1px solid #555; padding:0 4px; margin:0;">
                            <option value="">-- 选择成员 --</option>
                            ${npcOpts}
                        </select>
                        <input type="number" step="0.1" id="spec-npc-mult" value="0"
                            style="flex:none; width:50px; height:32px; background:#000;
                                   color:#fff; border:1px solid #555; text-align:center;
                                   box-sizing:border-box; margin:0; padding:0;" title="倍率">
                        <button type="button" class="q-btn accept" id="add-spec-rule"
                            style="flex:none; width:60px; height:32px; padding:0; margin:0;">
                            <i class="fas fa-plus"></i> 添加
                        </button>
                    </div>
                </div>
            </div>
        </div>`,
        buttons: {
            save: {
                label: "保存设置",
                callback: async (h) => {
                    repData.settings.factionLink.enabled   =
                        h.find("#gl-link-en").is(":checked");
                    repData.settings.factionLink.threshold =
                        parseInt(h.find("#gl-link-th").val()) || 10;

                    targetNPC.repLink       ??= {};
                    targetNPC.repLink.mode  =   parseInt(h.find("#npc-link-mode").val());
                    targetNPC.repLink.mult  =   parseFloat(h.find("#npc-link-mult").val()) || 1.0;
                    targetNPC.repLink.ignores = {};
                    h.find(".sr-mult").each(function () {
                        targetNPC.repLink.ignores[$(this).data("id")] =
                            parseFloat($(this).val()) || 0;
                    });

                    await saveRepData(repData);
                    ui.notifications.success("联动规则已保存。");
                }
            }
        },
        render: (h) => {
            renderRules(h);
            renderSpecRules(h);

            h.find("#add-lr").off("click").on("click", (e) => {
                e.preventDefault();
                targetNPC.repLink       ??= {};
                targetNPC.repLink.rules ??= [];
                targetNPC.repLink.rules.push({ min: 0, max: 1, mult: 1.0 });
                renderRules(h);
            });

            h.find("#add-spec-rule").off("click").on("click", (e) => {
                e.preventDefault();
                const sid  = h.find("#spec-npc-sel").val();
                if (!sid) return ui.notifications.warn("请选择一个NPC");
                const mult = parseFloat(h.find("#spec-npc-mult").val());
                targetNPC.repLink         ??= {};
                targetNPC.repLink.ignores ??= {};
                targetNPC.repLink.ignores[sid] = isNaN(mult) ? 0 : mult;
                renderSpecRules(h);
            });
        }
    }).render(true);
}