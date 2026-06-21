/**
 * ui-settings-panel.js
 * 系统设置面板（从宏1拆分）
 * 包含：触发引擎参数设置、玩家互动预设分组管理
 */

import { saveRepData } from "../data-manager.js";

/**
 * 打开系统设置面板
 * @param {object}       data    - 当前 repData
 * @param {JournalEntry} journal - 声望数据库Journal
 * @param {Function}     refresh - 刷新管理面板的回调
 */
export function openSettingsPanel(data, journal, refresh) {
    const s = data.settings;

    new Dialog({
        title:   "全局系统设置",
        content: `
        <div style="padding:10px; background:#1a1a1a; color:#eee;
             font-family:'Signika',sans-serif;">

            <h3 style="border-bottom:1px solid #444; padding-bottom:5px; color:#3498db;">
                系统触发引擎设置
            </h3>

            <div class="set-row">
                <label><b>触发模式</b></label>
                <select id="set-mode"
                    style="background:#111; color:#fff; border:1px solid #555; padding:4px;">
                    <option value="1" ${s.triggerMode == 1 ? "selected" : ""}>
                        模式1：经典双端各自弹窗
                    </option>
                    <option value="2" ${s.triggerMode == 2 ? "selected" : ""}>
                        模式2：仅靠近探测（DM拦截）
                    </option>
                    <option value="3" ${s.triggerMode == 3 ? "selected" : ""}>
                        模式3：区域 + 探测（全拦截）
                    </option>
                </select>
            </div>

            <div class="set-row">
                <label><b>探测距离</b>（格）</label>
                <input type="number" step="0.1" id="set-dist" value="${s.proximityDistance}"
                    style="width:60px; text-align:center; background:#111;
                           color:#fff; border:1px solid #555;">
            </div>

            <div class="set-row">
                <label><b>雷达冷却时间</b>（秒）</label>
                <input type="number" id="set-cooldown" value="${s.radarCooldown}"
                    style="width:60px; text-align:center; background:#111;
                           color:#fff; border:1px solid #555;">
            </div>

            <div class="set-row">
                <label title="同范围内同派系NPC打包成一条提示">
                    <b>派系扎堆合并半径</b>（格，0为不合并）
                </label>
                <input type="number" step="0.1" id="set-clump" value="${s.clumpRadius}"
                    style="width:60px; text-align:center; background:#111;
                           color:#fff; border:1px solid #555;">
            </div>

            <div class="set-row">
                <label title="判定多个人是否为同一批触发的等待时间">
                    <b>触发合并延迟</b>（毫秒）
                </label>
                <input type="number" id="set-hopper" value="${s.hopperDelay ?? 300}"
                    style="width:60px; text-align:center; background:#111;
                           color:#fff; border:1px solid #555;">
            </div>

            <h3 style="border-bottom:1px solid #444; padding-bottom:5px;
                margin-top:15px; color:#e67e22;">
                玩家互动预设分组
            </h3>
            <div id="preset-container"
                style="max-height:220px; overflow-y:auto; border:1px solid #333;
                       padding:5px; margin-bottom:10px; background:#111;"></div>
            <button id="add-preset-btn" class="n-btn"
                style="width:100%; background:#2980b9;">
                <i class="fas fa-plus"></i> 新建预设分组
            </button>
        </div>`,
        buttons: {
            save: {
                label: "保存设置", icon: '<i class="fas fa-save"></i>',
                callback: async (h) => {
                    s.triggerMode       = parseInt(h.find("#set-mode").val());
                    s.proximityDistance = parseFloat(h.find("#set-dist").val())    || 1.5;
                    s.radarCooldown     = parseInt(h.find("#set-cooldown").val())   || 20;
                    s.clumpRadius       = parseFloat(h.find("#set-clump").val())    || 0;
                    s.hopperDelay       = parseInt(h.find("#set-hopper").val())     || 300;
                    await saveRepData(data);
                    ui.notifications.success("系统设置已保存！");
                }
            }
        },
        render: (h) => {
            const renderPresets = () => {
                const pList = s.presets.length === 0
                    ? '<p style="text-align:center; color:#777;">暂无预设</p>'
                    : s.presets.map((p, idx) => `
                        <div class="preset-row">
                            <input type="text" class="p-name" data-idx="${idx}" value="${p.name}"
                                style="background:#000; color:#fff; border:1px solid #555;
                                       padding:4px; width:130px; font-weight:bold;">
                            <span style="font-size:0.85em; color:#bdc3c7;">
                                包含 ${p.users.length} 人
                            </span>
                            <div>
                                <button class="n-btn p-edit" data-idx="${idx}"
                                    style="padding:4px 8px; background:#f39c12; border:none; color:#fff;">
                                    <i class="fas fa-users"></i>
                                </button>
                                <button class="n-btn p-del" data-idx="${idx}"
                                    style="padding:4px 8px; background:#c0392b; border:none; color:#fff;">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>`
                    ).join("");

                h.find("#preset-container").html(pList);

                h.find(".p-name").on("change", function () {
                    s.presets[$(this).data("idx")].name = $(this).val();
                });

                h.find(".p-del").click(function () {
                    s.presets.splice($(this).data("idx"), 1);
                    renderPresets();
                });

                h.find(".p-edit").click(function () {
                    const pIdx  = $(this).data("idx");
                    const pData = s.presets[pIdx];
                    const users = game.users.filter(u => !u.isGM && u.character);
                    const cbHtml = users.map(u => `
                        <label style="display:block; margin-bottom:6px; cursor:pointer;
                            background:#2c3e50; padding:8px; border-radius:4px; color:#ecf0f1;">
                            <input type="checkbox" class="u-cb" value="${u.id}"
                                ${pData.users.includes(u.id) ? "checked" : ""}
                                style="transform:scale(1.2); margin-right:8px;">
                            ${u.name}
                            <span style="color:#bdc3c7; font-size:0.85em;">
                                (${u.character.name})
                            </span>
                        </label>`
                    ).join("");

                    new Dialog({
                        title:   `编辑预设: ${pData.name}`,
                        content: `<div style="padding:10px; background:#1a1a1a;">
                            ${cbHtml}
                        </div>`,
                        buttons: {
                            save: {
                                label: "确认",
                                callback: (sh) => {
                                    const sel = [];
                                    sh.find(".u-cb:checked").each(function () {
                                        sel.push($(this).val());
                                    });
                                    s.presets[pIdx].users = sel;
                                    renderPresets();
                                }
                            }
                        }
                    }, { resizable: true }).render(true);
                });
            };

            renderPresets();
            h.find("#add-preset-btn").click(() => {
                s.presets.push({ id: foundry.utils.randomID(), name: "新预设", users: [] });
                renderPresets();
            });
        }
    }, { width: 400, resizable: true }).render(true);
}