/**
 * utils.js
 * 公共工具函数库
 * 来源：原宏2中的 getWorldTimeString / getDaysDiff /
 *       parseItemsWithQuantity / calcAffectionUI / getFloatingGold
 */

/**
 * 获取当前游戏内时间字符串（依赖 Calendaria）
 * @returns {string}
 */
export function getWorldTimeString() {
    if (typeof CALENDARIA === "undefined" || !CALENDARIA.api) {
        return "未启用日历";
    }
    try {
        const now = CALENDARIA.api.getCurrentDateTime();
        const calData = CALENDARIA.api.calendar || game.time.calendar;
        const y   = now.year   ?? "";
        const d   = now.day    ?? 1;
        const h   = String(now.hour   ?? 0).padStart(2, "0");
        const min = String(now.minute ?? 0).padStart(2, "0");
        const mNum = parseInt(now.month) || 1;

        let monthName = `${mNum}月`;
        if (calData?.months) {
            const mArray = calData.months.values || calData.months;
            if (mArray) {
                const mData =
                    Array.from(mArray).find(m => m.ordinal == mNum) ||
                    mArray[mNum - 1];
                if (mData?.name) monthName = mData.name;
            }
        }
        return `${y}年 ${monthName} ${d}日 ${h}:${min}`;
    } catch (e) {
        return "时间格式错误";
    }
}

/**
 * 计算距离某个时间字符串已过去的天数（依赖 Calendaria）
 * @param {string} pastStr - getWorldTimeString() 返回的字符串
 * @returns {number} 天数差，异常时返回 999
 */
export function getDaysDiff(pastStr) {
    if (!pastStr || pastStr === "未启用日历" || pastStr === "时间格式错误") {
        return 999;
    }
    try {
        if (typeof CALENDARIA === "undefined" || !CALENDARIA.api) return 999;
        const now     = CALENDARIA.api.getCurrentDateTime();
        const calData = CALENDARIA.api.calendar || game.time.calendar;

        const match = pastStr.match(/(\d+)\s*年\s*(.+?)\s*(\d+)\s*日/);
        if (!match) return 999;

        const pYear     = parseInt(match[1]);
        const pMonthStr = match[2].trim();
        const pDay      = parseInt(match[3]);
        let   pMonthNum = 1;

        const extracted = parseInt(pMonthStr);
        if (!isNaN(extracted)) {
            pMonthNum = extracted;
        } else if (calData?.months) {
            const mArray = calData.months.values || calData.months;
            if (mArray) {
                const mData = Array.from(mArray).find(
                    m => m.name === pMonthStr || `${m.ordinal}月` === pMonthStr
                );
                if (mData) pMonthNum = mData.ordinal || 1;
            }
        }

        const totalNow  = now.year * 365 + (parseInt(now.month) || 1) * 30 + now.day;
        const totalPast = pYear   * 365 + pMonthNum * 30 + pDay;
        return totalNow - totalPast;
    } catch (e) {
        return 0;
    }
}

/**
 * 解析物品字符串，支持 UUID 链接与纯文本，支持 x2/*2 数量后缀
 * @param {string} itemStr
 * @returns {Array<{type, uuid?, name, qty, raw}>}
 */
export function parseItemsWithQuantity(itemStr) {
    const items = [];
    if (!itemStr) return items;

    const regex = /(@UUID\[(.*?)\](?:\{(.*?)\})?)(?:\s*[xX*×](\d+))?/g;
    let m;
    let parsedStr = itemStr;

    while ((m = regex.exec(itemStr)) !== null) {
        const uuid = m[2];
        const name = m[3] || uuid;
        const qty  = parseInt(m[4]) || 1;
        items.push({ type: "uuid", uuid, name, qty, raw: m[0] });
        parsedStr = parsedStr.replace(m[0], "");
    }

    parsedStr
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(p => {
            const pMatch = p.match(/(.*?)(?:\s*[xX*×](\d+))?$/);
            if (pMatch) {
                const name = pMatch[1].trim();
                const qty  = parseInt(pMatch[2]) || 1;
                if (name) items.push({ type: "plain", name, qty, raw: p });
            }
        });

    return items;
}

/**
 * 根据声望值计算进度条百分比与颜色
 * @param {number} aff
 * @returns {{percent: number, color: string}}
 */
export function calcAffectionUI(aff) {
    const percent = Math.max(0, Math.min(100, ((aff + 100) / 200) * 100));
    const color   = aff >= 0 ? "#27ae60" : "#c0392b";
    return { percent, color };
}

/**
 * 根据声望值和缩放规则计算实际发放金币
 * @param {number} baseGold
 * @param {number} affection
 * @param {Array}  scalingRules
 * @param {boolean} useScale
 * @returns {number}
 */
export function getFloatingGold(baseGold, affection, scalingRules, useScale) {
    if (!useScale || !baseGold || isNaN(baseGold)) return baseGold || 0;
    let multiplier = 1.0;
    for (const rule of scalingRules) {
        if (affection >= rule.min && affection <= rule.max) {
            multiplier = rule.mult;
            break;
        }
    }
    return Math.floor(baseGold * multiplier);
}