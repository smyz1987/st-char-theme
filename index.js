// st-char-theme: 角色卡 ↔ 酒馆UI主题 绑定扩展
// 角色卡编辑弹窗顶部的小桃子按钮 → 选择主题绑定到当前角色卡
// 进入该角色聊天时自动切换绑定主题（可在面板里手动关闭自动切换），离开该角色时恢复进入前的主题
import { eventSource, event_types } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getContext } from '../../../extensions.js';

const LS_KEY = 'st-char-theme-bindings';
const BTN_ID = 'st-ct-btn';
const PANEL_ID = 'st-ct-panel';

let boundChar = null;   // 当前处于"绑定主题"的角色 avatar
let themeBefore = null; // 进入该角色前的主题名
let preBindTheme = null;   // 编辑面板绑定操作时的恢复基准主题（绑定前酒馆用的主题）
let editSessionTheme = null; // 本次编辑面板会话打开瞬间的主题
let themeChangeByUs = false; // 标记：主题切换是扩展自己触发的（不应视为用户手动切换）

// ---------- 存储（兼容旧格式：{avatar: 'theme'} 字符串；带内存缓存避免重复 JSON.parse） ----------
let bindingsCache = null;
function loadBindings() {
    if (bindingsCache) return bindingsCache;
    try { bindingsCache = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch { bindingsCache = {}; }
    return bindingsCache;
}
function saveBindings(map) {
    bindingsCache = map;
    try { localStorage.setItem(LS_KEY, JSON.stringify(map)); }
    catch { /* ignore */ }
}
// 返回 { theme, autoApply } 或 null
function getBinding(avatar) {
    if (!avatar) return null;
    const b = loadBindings()[avatar];
    if (!b) return null;
    if (typeof b === 'string') return { theme: b, autoApply: true };
    return { theme: b.theme || '', autoApply: b.autoApply !== false };
}
function setBinding(avatar, theme, autoApply) {
    if (!avatar) return;
    const map = loadBindings();
    if (theme) {
        const old = map[avatar];
        map[avatar] = { theme: theme, autoApply: (typeof autoApply === 'boolean') ? autoApply : (!old || old.autoApply !== false) };
    } else {
        delete map[avatar];
    }
    saveBindings(map);
}
function setAutoApply(avatar, v) {
    if (!avatar) return;
    const map = loadBindings();
    const b = map[avatar];
    if (!b) return;
    if (typeof b === 'string') map[avatar] = { theme: b, autoApply: !!v };
    else b.autoApply = !!v;
    saveBindings(map);
}

// ---------- 主题 ----------
function currentTheme() {
    try {
        if (power_user && power_user.theme) return String(power_user.theme);
        const $sel = $('#themes');
        if ($sel.length) return String($sel.val() || '');
    } catch { /* ignore */ }
    return '';
}
function themeList() {
    const out = [];
    $('#themes option').each(function () {
        const v = String(this.value);
        if (v) out.push(v);
    });
    return out;
}
function setTheme(name) {
    if (!name) return;
    const $sel = $('#themes');
    if (!$sel.length) return;
    const exists = $sel.find('option').toArray().some(o => String(o.value) === name);
    if (!exists) return;
    if (String($sel.val()) === name) return;
    themeChangeByUs = true; // 扩展自动切换：不视为用户手动改主题
    $sel.val(name).trigger('change');
}
// 用户手动切换主题 → 编辑会话的绑定恢复基准失效（用户已主动改变主题语境）
// 用 document 委托挂载：扩展加载时 #themes 可能尚未渲染，直接挂会丢失监听
$(document).on('change.stctTheme', '#themes', function () {
    if (themeChangeByUs) { themeChangeByUs = false; return; }
    preBindTheme = null;
});

// ---------- 角色切换逻辑 ----------
function getCurrentChar() {
    try {
        const ctx = getContext();
        let id = (ctx && typeof ctx.characterId !== 'undefined') ? ctx.characterId : -1;
        if (id < 0 && typeof character_id !== 'undefined') id = character_id;
        if (id < 0 || !ctx || !ctx.characters || !ctx.characters[id]) {
            // fallback：仅当编辑面板可见时读头像字段（首页加载时面板关闭，输入框残留值会误判成当前角色）
            const $edit = $('#rm_ch_create_block');
            if ($edit.length && $edit.is(':visible')) {
                const $av = $('#avatar_url_pole');
                if ($av.length) {
                    const v = String($av.val() || '').trim();
                    if (v) {
                        const fn = v.split(/[\\/]/).pop();
                        return fn || null;
                    }
                }
            }
            return null;
        }
        const c = ctx.characters[id];
        return c && c.avatar ? c.avatar : null;
    } catch { return null; }
}
// 当前角色的显示名（用于匹配专属美化）：仅编辑面板可见时读输入框，否则用聊天上下文角色名（避免输入框残留值污染专属匹配）
function getCurrentCharName() {
    try {
        const $edit = $('#rm_ch_create_block');
        if ($edit.length && $edit.is(':visible')) {
            const $name = $('#character_name_pole, #character_name').first();
            if ($name.length) {
                const v = String($name.val() || '').trim();
                if (v) return v;
            }
        }
        const ctx = getContext();
        let id = (ctx && typeof ctx.characterId !== 'undefined') ? ctx.characterId : -1;
        if (id < 0 && typeof character_id !== 'undefined') id = character_id;
        if (id < 0 || !ctx || !ctx.characters || !ctx.characters[id]) return '';
        const c = ctx.characters[id];
        return c ? String(c.name || '') : '';
    } catch { return ''; }
}
// 专属匹配：主题名与角色名存在完全包含关系（双向），长度须 >1 防误判；charNameLow 为已小写的角色名
function matchOwnTheme(themeName, charNameLow) {
    if (!charNameLow) return false;
    const t = String(themeName || '').toLowerCase().trim();
    if (!t || t.length <= 1 || charNameLow.length <= 1) return false;
    return t.includes(charNameLow) || charNameLow.includes(t);
}
// 专属美化自动应用：找与角色名重叠的最佳主题（完全相等优先，否则取最短匹配）；无匹配返回 ''
function findOwnTheme(charNameLow) {
    if (!charNameLow || charNameLow.length <= 1) return '';
    const themes = themeList();
    let best = '';
    for (const t of themes) {
        const tl = String(t).toLowerCase().trim();
        if (!tl || tl.length <= 1) continue;
        if (tl === charNameLow) return t; // 完全相等最优先
        if (tl.includes(charNameLow) || charNameLow.includes(tl)) {
            if (!best || tl.length < best.length) best = t;
        }
    }
    return best;
}
// 是否正在聊天中（编辑面板场景 characterId 为 -1）
function inChat() {
    try {
        const ctx = getContext();
        const id = (ctx && typeof ctx.characterId !== 'undefined') ? ctx.characterId : -1;
        return id >= 0;
    } catch { return false; }
}
function onCharChanged() {
    const cur = getCurrentChar();
    if (cur === boundChar) {
        updateBtnDot();
        return;
    }
    // 离开上一个绑定角色 → 恢复进入前主题
    if (boundChar && themeBefore) {
        setTheme(themeBefore);
        themeBefore = null;
    }
    boundChar = null;
    // 进入新角色：手动绑定（自动切换开）优先；无手动绑定但有同名专属美化时自动应用（每次进入都生效）
    if (cur) {
        const bind = getBinding(cur);
        let apply = null;
        if (bind && bind.theme && bind.autoApply) {
            apply = bind.theme;
        } else if (!bind || !bind.theme) {
            apply = findOwnTheme(getCurrentCharName().toLowerCase().trim());
        }
        if (apply) {
            if (bind && bind.theme && bind.autoApply) {
                // 手动绑定：恢复基准优先用编辑会话绑定时的主题（解决"绑定后退出不恢复原美化"），否则用进入前的当前主题
                themeBefore = preBindTheme || currentTheme();
                preBindTheme = null;
            } else {
                // 专属自动应用：不消费 preBindTheme（那是给手动绑定角色用的恢复基准，先进无绑定角色再进绑定角色时仍要生效）；
                // 恢复基准 = 进入该角色前的当前主题
                themeBefore = currentTheme();
            }
            setTheme(apply);
            boundChar = cur;
        }
        // 无绑定且无专属匹配：保留 preBindTheme（用户未手动改主题则仍适用于之后进入的绑定角色）；手动改主题由 #themes change 监听清理
    }
    updateBtnDot();
}
eventSource.on(event_types.CHAT_CHANGED, onCharChanged);
eventSource.on(event_types.CHAT_LOADED, onCharChanged);

// ---------- 桃子按钮 & 绑定面板 ----------
const PEACH_SVG = '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 7C11 3.6 7 3.2 5.4 7C3.8 10.8 8 17 12 18.6C16 17 20.2 10.8 18.6 7C17 3.2 13 3.6 12 7Z" fill="#D9A7A7"/><path d="M12 7C11.4 4.6 12.2 3 13.8 2.4" stroke="#A9C3A0" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M10.6 5.4C9.2 3.6 7 3.4 5.8 4.8" stroke="#A9C3A0" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>';

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildPanelHTML(curChar, curBind) {
    const themes = themeList();
    const curTheme = currentTheme();
    const charName = getCurrentCharName();
    const charNameLow = charName.toLowerCase().trim();
    const ownSet = new Set(themes.filter(t => matchOwnTheme(t, charNameLow)));
    const ordered = themes.filter(t => ownSet.has(t)).concat(themes.filter(t => !ownSet.has(t)));
    let rows = ordered.map(t => {
        const isBound = (curBind && t === curBind.theme);
        const isActive = (!curBind && t === curTheme);
        const isOwn = ownSet.has(t);
        return '<div class="st-ct-row' + (isBound ? ' st-ct-bound' : '') + (isOwn ? ' st-ct-own' : '') + '" data-theme="' + escapeHtml(t) + '">' +
            '<span class="st-ct-row-name">' + escapeHtml(t) + '</span>' +
            (isOwn ? '<span class="st-ct-row-tag st-ct-own-tag">专属</span>' : '') +
            (isBound ? '<span class="st-ct-row-tag">已绑定</span>' : (isActive ? '<span class="st-ct-row-tag">当前</span>' : '')) +
            '</div>';
    }).join('');
    if (!rows) rows = '<div class="st-ct-empty">（未找到可用主题）</div>';
    let curLine = '未绑定（进入聊天不会自动切换）';
    if (curBind) {
        curLine = '已绑定：' + escapeHtml(curBind.theme) + (curBind.autoApply ? '（进入自动切换）' : '（自动切换已关闭）');
    } else if (ownSet.size) {
        curLine = '有 ' + ownSet.size + ' 个专属匹配，进入聊天会自动应用';
    }
    let ownHint = '';
    if (ownSet.size) {
        ownHint = '<div class="st-ct-own-hint">已匹配 ' + ownSet.size + ' 个专属美化（名字与角色重叠），已排在列表最前</div>';
    }
    let footer = '<label class="st-ct-auto"><input type="checkbox" id="st-ct-auto"' + (!curBind || curBind.autoApply ? ' checked' : '') + '> 进入该角色时自动切换</label>';
    if (curBind) {
        footer += '<div class="st-ct-clear">解除绑定</div>';
    }
    return '<div class="st-ct-title">角色主题绑定</div>' +
        '<div class="st-ct-char">当前角色：' + (charName ? escapeHtml(charName) : '未知') + '</div>' +
        '<div class="st-ct-cur">' + curLine + '</div>' +
        ownHint +
        '<div class="st-ct-search"><input type="text" id="st-ct-search" placeholder="搜索主题…" autocomplete="off"></div>' +
        '<div class="st-ct-list">' + rows + '</div>' +
        footer;
}

function refreshBinding() {
    const cur = getCurrentChar();
    const bind = cur ? getBinding(cur) : null;
    const $btn = $('#' + BTN_ID);
    if ($btn.length) $btn.toggleClass('st-ct-has-bind', !!(bind && bind.theme));
    const $panel = $('#' + PANEL_ID);
    if ($panel.length && $panel.is(':visible')) {
        const q = String($panel.find('#st-ct-search').val() || '');
        $panel.html(buildPanelHTML(cur, bind));
        bindPanelEvents(cur, bind);
        if (q) {
            $panel.find('#st-ct-search').val(q).trigger('input');
        }
    }
}

function bindPanelEvents(curChar, curBind) {
    const $panel = $('#' + PANEL_ID);
    $panel.off('.stct').on('click.stct', '.st-ct-row', function (e) {
        e.stopPropagation();
        const theme = $(this).attr('data-theme');
        if (!theme) return;
        const auto = !!$panel.find('#st-ct-auto').prop('checked');
        // 恢复基准：
        // - 已在聊天中且该角色尚未进入"绑定恢复"状态：绑定操作时的当前主题即进入前主题（绑定前未切过主题）
        // - 已在聊天中且已在恢复状态（专属自动应用过）：保留原恢复基准，不被本次换绑覆盖
        // - 编辑面板场景（不在聊天）：用编辑会话起始主题，进入聊天时再消费
        if (boundChar !== curChar) {
            if (inChat()) {
                themeBefore = currentTheme();
                boundChar = curChar;
            } else {
                preBindTheme = editSessionTheme || currentTheme();
            }
        }
        setBinding(curChar, theme, auto);
        setTheme(theme); // 点击绑定立即应用该主题
        refreshBinding();
    });
    $panel.off('change.stctAuto').on('change.stctAuto', '#st-ct-auto', function (e) {
        e.stopPropagation();
        setAutoApply(curChar, this.checked);
        refreshBinding();
    });
    $panel.off('click.stctClear').on('click.stctClear', '.st-ct-clear', function (e) {
        e.stopPropagation();
        setBinding(curChar, '');
        refreshBinding();
    });
    // 搜索过滤：实时按主题名过滤列表
    $panel.off('input.stctSearch').on('input.stctSearch', '#st-ct-search', function (e) {
        e.stopPropagation();
        const q = String(this.value || '').trim().toLowerCase();
        let shown = 0;
        $panel.find('.st-ct-row').each(function () {
            const t = String($(this).attr('data-theme') || '').toLowerCase();
            const hit = !q || t.includes(q);
            $(this).toggle(hit);
            if (hit) shown++;
        });
        $panel.find('.st-ct-empty-search').remove();
        if (shown === 0) {
            $panel.find('.st-ct-list').append('<div class="st-ct-empty st-ct-empty-search">（无匹配主题）</div>');
        }
    });
    // 面板内交互不冒泡（防止误触外部关闭逻辑）
    $panel.on('mousedown.stct touchstart.stct', function (e) { e.stopPropagation(); });
}

function closePanel() {
    $('#' + PANEL_ID).remove();
}

// 更新按钮红点（事件驱动：绑定写入/角色切换时调用，轮询不再查）
function updateBtnDot() {
    const $btn = $('#' + BTN_ID);
    if (!$btn.length) return;
    const cur = getCurrentChar();
    const bind = cur ? getBinding(cur) : null;
    $btn.toggleClass('st-ct-has-bind', !!(bind && bind.theme));
}

function injectButton() {
    const $panel = $('#rm_ch_create_block');
    if (!$panel.length || !$panel.is(':visible')) return;
    const $btn = $('#' + BTN_ID);
    if ($btn.length) return; // 已注入，轮询不重复操作（红点由事件驱动更新）
    const cur = getCurrentChar();
    if (!cur) return; // 无法识别当前角色（如新建角色）→ 不注入，避免无效绑定
    const $anchor = $('#favorite_button');
    if (!$anchor.length) return;
    const $b = $('<div id="' + BTN_ID + '" class="st-ct-btn" title="绑定主题美化到这张角色卡">' + PEACH_SVG + '</div>');
    $anchor.after($b);
    $b.on('click', function (e) {
        e.stopPropagation();
        if ($('#' + PANEL_ID).length) { closePanel(); return; }
        const bind = cur ? getBinding(cur) : null;
        const $panel = $('<div id="' + PANEL_ID + '" class="st-ct-panel"></div>');
        $panel.html(buildPanelHTML(cur, bind));
        $('body').append($panel);
        // 定位：完整放在视口内（手机上不再被顶部/底部遮挡）
        const r = $b[0].getBoundingClientRect();
        const pw = $panel[0].offsetWidth;
        const ph = $panel[0].offsetHeight;
        $panel.css({
            top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - ph - 8)) + 'px',
            left: Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + 'px',
        });
        bindPanelEvents(cur, bind);
        // 已绑定主题行滚动到可见（方便打开面板时直接看到当前绑定）
        if (bind && bind.theme) {
            const $row = $panel.find('.st-ct-row.st-ct-bound');
            const $list = $panel.find('.st-ct-list');
            if ($row.length && $list.length) {
                $list.scrollTop(Math.max(0, $row[0].offsetTop - $list[0].offsetTop - 20));
            }
        }
    });
    updateBtnDot();
}

// 轮询：角色编辑面板打开时注入桃子按钮；可见性状态缓存，翻转时才动作（性能优化）
let lastEditPanelVisible = false;
let lastEditName = null; // 编辑面板当前编辑的角色名（切换编辑角色时按钮需跟随）
setInterval(function () {
    const $panel = $('#rm_ch_create_block');
    const vis = !!($panel.length && $panel.is(':visible'));
    if (vis === lastEditPanelVisible) {
        if (vis) {
            const nm = String(($('#character_name_pole').val() || '')).trim();
            if (nm !== lastEditName) {
                // 编辑面板内切换了编辑角色：关闭旧绑定面板、移除旧按钮重新注入（绑定上下文跟随当前角色）
                lastEditName = nm;
                closePanel();
                $('#' + BTN_ID).remove();
                injectButton();
            } else if (!$('#' + BTN_ID).length) {
                injectButton(); // 兜底补注入（按钮意外丢失时）
            }
        }
        return;
    }
    lastEditPanelVisible = vis;
    if (vis) {
        lastEditName = String(($('#character_name_pole').val() || '')).trim();
        editSessionTheme = currentTheme(); // 记录本次编辑会话打开瞬间的主题（绑定恢复基准）
        injectButton();
    } else {
        lastEditName = null;
        editSessionTheme = null;
        closePanel();
        $('#' + BTN_ID).remove();
    }
}, 400);

// 点击面板/按钮以外区域关闭（移动端：滑动后 300ms 内的合成 click 忽略，避免滑动列表误关面板）
let lastTouchMove = 0;
$(document).on('touchmove.stct', function () { lastTouchMove = Date.now(); });
$(document).on('click.stct', function (e) {
    if (Date.now() - lastTouchMove < 300) return;
    if (!$(e.target).closest('#' + BTN_ID).length && !$(e.target).closest('#' + PANEL_ID).length) {
        closePanel();
    }
});

// CSS
const STYLE_ID = 'st-ct-style';
if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#st-ct-btn { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; margin-left:6px; cursor:pointer; position:relative; vertical-align:middle; opacity:.85; transition:opacity .15s, transform .15s; background:rgba(217,167,167,.22); border-radius:6px; padding:2px; box-sizing:content-box; }
#st-ct-btn:hover { opacity:1; transform:scale(1.12); }
#st-ct-btn.st-ct-has-bind::after { content:''; position:absolute; top:-1px; right:-1px; width:7px; height:7px; border-radius:50%; background:#E8A0A0; border:1px solid #fff; }
.st-ct-panel { position:fixed; z-index:99999; width:min(320px,calc(100vw - 24px)); max-height:340px; overflow-y:auto; background:var(--SmartThemeBlurTintColor,#1e1e2e); color:var(--SmartThemeMainColor,#e0e0e0); border:1px solid var(--SmartThemeBorderColor,#666); border-radius:10px; padding:10px 12px; box-shadow:0 6px 24px rgba(0,0,0,.35); font-size:13px; }
.st-ct-title { font-weight:700; margin-bottom:6px; color:#D9A7A7; }
.st-ct-char { font-size:12px; opacity:.75; margin-bottom:2px; word-break:break-all; }
.st-ct-cur { font-size:12px; margin-bottom:8px; padding:4px 8px; border-radius:6px; background:rgba(217,167,167,.12); }
.st-ct-list { max-height:210px; overflow-y:auto; }
.st-ct-search { margin-bottom:6px; }
.st-ct-search input { width:100%; box-sizing:border-box; padding:5px 8px; border-radius:6px; border:1px solid var(--SmartThemeBorderColor,#666); background:var(--SmartThemeBlurTintColor,#2a2a3a); color:var(--SmartThemeMainColor,#e0e0e0); font-size:12px; outline:none; }
.st-ct-search input::placeholder { opacity:.55; }
.st-ct-row { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:6px 8px; border-radius:6px; cursor:pointer; }
.st-ct-row:hover { background:rgba(217,167,167,.15); }
.st-ct-row.st-ct-bound { background:rgba(217,167,167,.28); }
.st-ct-row-name { flex:1; min-width:0; white-space:normal; word-break:break-all; color:#D9A7A7; line-height:1.35; }
.st-ct-row-tag { font-size:11px; opacity:.8; flex-shrink:0; margin-left:6px; white-space:nowrap; }
.st-ct-own { background:rgba(217,167,167,.18); }
.st-ct-own-tag { color:#D96A6A; font-weight:700; opacity:1; }
.st-ct-own-hint { font-size:12px; margin-bottom:6px; padding:4px 8px; border-radius:6px; background:rgba(217,167,167,.22); color:#F2C9C9; }
.st-ct-auto { display:flex; align-items:center; gap:6px; margin-top:8px; padding:4px 8px; border-radius:6px; background:rgba(217,167,167,.12); cursor:pointer; font-size:12px; }
.st-ct-auto input { accent-color:#D9A7A7; }
.st-ct-clear { margin-top:6px; text-align:center; padding:5px 0; border-radius:6px; color:#fff; background:rgba(190,90,90,.75); cursor:pointer; }
.st-ct-clear:hover { background:rgba(190,90,90,.95); }
.st-ct-empty { text-align:center; padding:8px 0; opacity:.6; }
`;
    document.head.appendChild(style);
}
