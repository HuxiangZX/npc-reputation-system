/**
 * data-manager.js
 * 统一的数据读写层。
 */

const DB_REP   = "NPC_Reputation_Database";
const DB_QUEST = "NPC_Quest_Database";

// ─── 声望数据库 ───────────────────────────────────────────────

/**
 * 获取声望数据库 Journal，不存在则返回 null
 * @returns {JournalEntry|null}
 */
export function getRepJournal() {
    return game.journal.getName(DB_REP) ?? null;
}

/**
 * 自动创建声望数据库 Journal（仅 GM 调用）
 * @returns {Promise<JournalEntry>}
 */
export async function getOrCreateRepJournal() {
    let journal = game.journal.getName(DB_REP);
    if (!journal) {
        console.log(`[NPC声望系统] 声望数据库 Journal 不存在，正在自动创建…`);
        journal = await JournalEntry.create({
            name:  DB_REP,
            flags: {
                world: {
                    npcData: {
                        factions:     {},
                        independent:  [],
                        factionOrder: [],
                        settings: {
                            triggerMode:       3,
                            proximityDistance: 1.5,
                            radarCooldown:     20,
                            clumpRadius:       3,
                            hopperDelay:       300,
                            presets:           [],
                            factionLink:       {
                                enabled:   false,
                                threshold: 10,
                                rules:     []
                            },
                            questPresets:   [],
                            rewardPresets:  []
                        },
                        goldScaling: [
                            { min: -Infinity, max: -41,      mult: 0    },
                            { min: -40,       max: -31,      mult: 0.7  },
                            { min: -30,       max: -21,      mult: 0.9  },
                            { min: -20,       max: -11,      mult: 0.95 },
                            { min: -10,       max:  10,      mult: 1.0  },
                            { min:  11,       max:  20,      mult: 1.05 },
                            { min:  21,       max:  30,      mult: 1.1  },
                            { min:  31,       max:  40,      mult: 1.2  },
                            { min:  41,       max: Infinity, mult: 1.3  }
                        ]
                    }
                }
            }
        });
        console.log(`[NPC声望系统] 声望数据库 Journal 已创建：${journal.id}`);
    }
    return journal;
}

/**
 * 读取完整的 npcData 对象，并补全缺失字段的默认值
 * @returns {object}
 */
export function getRepData() {
    const journal = getRepJournal();
    const data = journal?.getFlag("world", "npcData") ?? {
        factions:     {},
        independent:  [],
        factionOrder: []
    };

    data.factions     ??= {};
    data.independent  ??= [];
    data.factionOrder ??= [];
    data.settings     ??= {};
    data.goldScaling  ??= [
        { min: -Infinity, max: -41,      mult: 0    },
        { min: -40,       max: -31,      mult: 0.7  },
        { min: -30,       max: -21,      mult: 0.9  },
        { min: -20,       max: -11,      mult: 0.95 },
        { min: -10,       max:  10,      mult: 1.0  },
        { min:  11,       max:  20,      mult: 1.05 },
        { min:  21,       max:  30,      mult: 1.1  },
        { min:  31,       max:  40,      mult: 1.2  },
        { min:  41,       max: Infinity, mult: 1.3  }
    ];

    data.settings.triggerMode        ??= 3;
    data.settings.proximityDistance  ??= 1.5;
    data.settings.radarCooldown      ??= 20;
    data.settings.clumpRadius        ??= 3;
    data.settings.hopperDelay        ??= 300;
    data.settings.presets            ??= [];
    data.settings.factionLink        ??= {
        enabled: false, threshold: 10, rules: []
    };
    data.settings.questPresets       ??= [];
    data.settings.rewardPresets      ??= [];

    return data;
}

/**
 * 将 npcData 写回 Journal
 * @param {object} data
 * @returns {Promise<void>}
 */
export async function saveRepData(data) {
    const journal = getRepJournal();
    if (!journal) {
        console.error("[NPC声望系统] 未找到声望数据库 Journal，无法保存！");
        return;
    }
    await journal.setFlag("world", "npcData", data);
}

// ─── 任务数据库 ───────────────────────────────────────────────

/**
 * 获取任务数据库 Journal，不存在则自动创建（仅 GM 端调用）
 * @returns {Promise<JournalEntry>}
 */
export async function getOrCreateQuestJournal() {
    let journal = game.journal.getName(DB_QUEST);
    if (!journal) {
        console.log(`[NPC声望系统] 任务数据库 Journal 不存在，正在自动创建…`);
        journal = await JournalEntry.create({
            name:  DB_QUEST,
            flags: { world: { quests: [] } }
        });
        console.log(`[NPC声望系统] 任务数据库 Journal 已创建：${journal.id}`);
    }
    return journal;
}

/**
 * 读取任务数组
 * @returns {Promise<Array>}
 */
export async function getQuests() {
    const journal = await getOrCreateQuestJournal();
    return journal.getFlag("world", "quests") ?? [];
}

/**
 * 写回任务数组
 * @param {Array} quests
 * @returns {Promise<void>}
 */
export async function saveQuests(quests) {
    const journal = await getOrCreateQuestJournal();
    await journal.setFlag("world", "quests", quests);
}

// ─── 便捷查询工具 ─────────────────────────────────────────────

/**
 * 从 repData 中找到指定 id 的 NPC
 * @param {object} repData
 * @param {string} npcId
 * @returns {{ npc: object|null, factionId: string, factionName: string }}
 */
export function findNPCById(repData, npcId) {
    const indep = repData.independent.find(n => n.id === npcId);
    if (indep) {
        return { npc: indep, factionId: "ind", factionName: "独立 NPC" };
    }

    for (const [fid, fData] of Object.entries(repData.factions)) {
        if (fid.startsWith("-=")) continue;
        const match = fData.members.find(n => n.id === npcId);
        if (match) {
            return {
                npc:         match,
                factionId:   fid,
                factionName: fData.name
            };
        }
    }

    return { npc: null, factionId: "", factionName: "" };
}

/**
 * 返回所有 NPC 的扁平数组
 * @param {object} repData
 * @returns {Array}
 */
export function getAllNPCs(repData) {
    const all = [...repData.independent];
    for (const [fid, fData] of Object.entries(repData.factions)) {
        if (fid.startsWith("-=") || !fData) continue;
        all.push(...fData.members);
    }
    return all;
}