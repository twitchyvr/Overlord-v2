-- =============================================================================
-- Keyboard Shortcuts — Overlord Plugin
-- =============================================================================
-- This plugin adds configurable keyboard shortcuts to the Overlord interface.
-- It ships with sensible defaults for common navigation and actions, and you
-- can add, change, or remove shortcuts through plugin storage.
--
-- HOW IT WORKS:
--   1. On load, the plugin reads shortcut mappings from storage (or creates
--      defaults) and emits "shortcuts:register" so the frontend can bind them.
--   2. Each shortcut maps a key combination to an action name that the
--      frontend knows how to execute.
--   3. You can customise shortcuts by updating the "shortcuts" key in storage.
--
-- KEY COMBO FORMAT:
--   Modifiers are separated by "+".  Examples:
--     "ctrl+k"          — Ctrl and K
--     "ctrl+shift+r"    — Ctrl, Shift, and R
--     "alt+1"           — Alt and 1
--   Supported modifiers: ctrl, shift, alt, meta (Cmd on macOS)
--
-- ACTION FORMAT:
--   Actions are colon-separated strings:
--     "navigate:rooms"      — go to the rooms view
--     "navigate:agents"     — go to the agents view
--     "navigate:room:<id>"  — go to a specific room
--     "panel:toggle:help"   — toggle the help panel
--     "command:palette"     — open the command palette
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Simple JSON helpers (no external dependencies)
-- ---------------------------------------------------------------------------

--- Encode a single shortcut table as a JSON object string.
local function encodeShortcut(s)
    local parts = {}
    for k, v in pairs(s) do
        local safeVal = tostring(v):gsub('"', '\\"')
        table.insert(parts, '"' .. tostring(k) .. '":"' .. safeVal .. '"')
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

--- Encode a list of shortcuts as a JSON array string.
local function encodeShortcutList(list)
    local items = {}
    for _, s in ipairs(list) do
        table.insert(items, encodeShortcut(s))
    end
    return "[" .. table.concat(items, ",") .. "]"
end

--- Decode a JSON array of shortcut objects back to a Lua table.
local function decodeShortcutList(raw)
    if not raw or raw == "" then
        return nil
    end

    local shortcuts = {}
    for obj in raw:gmatch("{(.-)}") do
        local entry = {}
        for key, value in obj:gmatch('"([^"]+)":"([^"]*)"') do
            entry[key] = value
        end
        if entry.combo and entry.action then
            table.insert(shortcuts, entry)
        end
    end

    if #shortcuts == 0 then
        return nil
    end
    return shortcuts
end

-- ---------------------------------------------------------------------------
-- Default shortcut mappings
-- ---------------------------------------------------------------------------
local DEFAULT_SHORTCUTS = {
    -- Navigation
    { combo = "ctrl+shift+r",  action = "navigate:rooms",          label = "Go to Rooms" },
    { combo = "ctrl+shift+a",  action = "navigate:agents",         label = "Go to Agents" },
    { combo = "ctrl+shift+t",  action = "navigate:tasks",          label = "Go to Tasks" },
    { combo = "ctrl+shift+d",  action = "navigate:dashboard",      label = "Go to Dashboard" },
    { combo = "ctrl+shift+l",  action = "navigate:logs",           label = "Go to Activity Log" },
    { combo = "ctrl+shift+s",  action = "navigate:settings",       label = "Go to Settings" },

    -- Quick-switch rooms by number (Alt+1 through Alt+5)
    { combo = "alt+1",         action = "navigate:room:index:0",   label = "Switch to Room 1" },
    { combo = "alt+2",         action = "navigate:room:index:1",   label = "Switch to Room 2" },
    { combo = "alt+3",         action = "navigate:room:index:2",   label = "Switch to Room 3" },
    { combo = "alt+4",         action = "navigate:room:index:3",   label = "Switch to Room 4" },
    { combo = "alt+5",         action = "navigate:room:index:4",   label = "Switch to Room 5" },

    -- Panels and commands
    { combo = "ctrl+k",        action = "command:palette",         label = "Open Command Palette" },
    { combo = "ctrl+shift+h",  action = "panel:toggle:help",       label = "Toggle Help Panel" },
    { combo = "ctrl+shift+p",  action = "panel:toggle:plugins",    label = "Toggle Plugin Panel" },

    -- Actions
    { combo = "ctrl+enter",    action = "action:send-message",     label = "Send Message" },
    { combo = "ctrl+shift+n",  action = "action:new-room",         label = "Create New Room" },
    { combo = "escape",        action = "action:close-modal",      label = "Close Modal / Cancel" }
}

-- ---------------------------------------------------------------------------
-- Storage helpers
-- ---------------------------------------------------------------------------

--- Load shortcuts from plugin storage. Returns table or nil.
local function loadShortcuts()
    local ok, raw = pcall(overlord.storage.get, "shortcuts")
    if not ok or not raw then
        return nil
    end
    return decodeShortcutList(raw)
end

--- Save shortcuts to plugin storage.
local function saveShortcuts(shortcuts)
    local encoded = encodeShortcutList(shortcuts)
    local ok, err = pcall(overlord.storage.set, "shortcuts", encoded)
    if not ok then
        overlord.log.error("Failed to save shortcuts", { error = tostring(err) })
        return false
    end
    return true
end

-- ---------------------------------------------------------------------------
-- Helper: check for duplicate combos
-- ---------------------------------------------------------------------------
local function findByCombo(shortcuts, combo)
    local lowerCombo = combo:lower()
    for i, s in ipairs(shortcuts) do
        if s.combo:lower() == lowerCombo then
            return i, s
        end
    end
    return nil, nil
end

-- ---------------------------------------------------------------------------
-- Helper: build a grouped summary for display / logging
-- ---------------------------------------------------------------------------
local function groupShortcuts(shortcuts)
    local groups = {}
    for _, s in ipairs(shortcuts) do
        -- Derive group from the action prefix (e.g. "navigate" from "navigate:rooms")
        local group = s.action:match("^([^:]+)") or "other"
        if not groups[group] then
            groups[group] = {}
        end
        table.insert(groups[group], {
            combo  = s.combo,
            action = s.action,
            label  = s.label or s.action
        })
    end
    return groups
end

-- =============================================================================
-- Lifecycle Hooks
-- =============================================================================

-- ---------------------------------------------------------------------------
-- onLoad — Initialise shortcuts and register them with the frontend
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
    overlord.log.info("Keyboard Shortcuts loading", {
        pluginId = overlord.manifest.id,
        version  = overlord.manifest.version
    })

    -- Load saved shortcuts, or seed defaults on first run
    local shortcuts = loadShortcuts()
    if not shortcuts then
        overlord.log.info("No saved shortcuts found — creating defaults")
        shortcuts = DEFAULT_SHORTCUTS
        saveShortcuts(shortcuts)
    end

    -- Build the registration payload
    local registrations = {}
    for _, s in ipairs(shortcuts) do
        table.insert(registrations, {
            combo  = s.combo,
            action = s.action,
            label  = s.label or s.action
        })
    end

    -- Emit the bulk registration event
    local ok, err = pcall(overlord.bus.emit, "shortcuts:register", {
        pluginId  = overlord.manifest.id,
        shortcuts = registrations,
        groups    = groupShortcuts(shortcuts)
    })

    if not ok then
        overlord.log.error("Failed to register shortcuts", { error = tostring(err) })
        return
    end

    overlord.log.info("Keyboard shortcuts registered", { count = #shortcuts })
end)

-- ---------------------------------------------------------------------------
-- onUnload — Deregister all shortcuts so the frontend removes the bindings
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
    local ok, err = pcall(overlord.bus.emit, "shortcuts:deregister", {
        pluginId = overlord.manifest.id
    })
    if not ok then
        overlord.log.warn("Failed to deregister shortcuts", { error = tostring(err) })
    end
    overlord.log.info("Keyboard Shortcuts unloaded")
end)

-- ---------------------------------------------------------------------------
-- onToolExecute — Listen for shortcut management commands
--
-- Supported commands:
--   "shortcuts:add <combo>|<action>|<label>"   — add or update a shortcut
--   "shortcuts:remove <combo>"                 — remove a shortcut by combo
--   "shortcuts:list"                           — emit the full shortcut list
--   "shortcuts:reset"                          — restore defaults
-- ---------------------------------------------------------------------------
registerHook("onToolExecute", function(context)
    local command = ""
    if context then
        command = context.command or context.args or ""
    end

    if not command:match("^shortcuts:") then
        return
    end

    overlord.log.debug("Shortcut command received", { command = command })

    -- -----------------------------------------------------------------------
    -- shortcuts:add <combo>|<action>|<label>
    -- -----------------------------------------------------------------------
    if command:match("^shortcuts:add") then
        local params = command:match("^shortcuts:add%s+(.+)$")
        if not params then
            overlord.log.warn("shortcuts:add requires combo|action|label")
            return
        end

        local parts = {}
        for part in params:gmatch("[^|]+") do
            table.insert(parts, part:match("^%s*(.-)%s*$"))
        end

        if #parts < 2 then
            overlord.log.warn("shortcuts:add requires at least combo|action", { received = #parts })
            return
        end

        local newShortcut = {
            combo  = parts[1],
            action = parts[2],
            label  = parts[3] or parts[2]
        }

        local shortcuts = loadShortcuts() or {}
        local idx, _ = findByCombo(shortcuts, newShortcut.combo)

        if idx then
            -- Update existing binding
            shortcuts[idx] = newShortcut
            overlord.log.info("Shortcut updated", { combo = newShortcut.combo, action = newShortcut.action })
        else
            -- Add new binding
            table.insert(shortcuts, newShortcut)
            overlord.log.info("Shortcut added", { combo = newShortcut.combo, action = newShortcut.action })
        end

        saveShortcuts(shortcuts)

        -- Re-register so the frontend picks up the change
        pcall(overlord.bus.emit, "shortcuts:register", {
            pluginId  = overlord.manifest.id,
            shortcuts = shortcuts,
            groups    = groupShortcuts(shortcuts)
        })

    -- -----------------------------------------------------------------------
    -- shortcuts:remove <combo>
    -- -----------------------------------------------------------------------
    elseif command:match("^shortcuts:remove") then
        local combo = command:match("^shortcuts:remove%s+(.+)$")
        if not combo then
            overlord.log.warn("shortcuts:remove requires a key combo")
            return
        end

        local shortcuts = loadShortcuts()
        if not shortcuts then
            overlord.log.warn("No shortcuts to remove from")
            return
        end

        local idx, _ = findByCombo(shortcuts, combo)
        if not idx then
            overlord.log.warn("Shortcut not found", { combo = combo })
            return
        end

        table.remove(shortcuts, idx)
        saveShortcuts(shortcuts)
        overlord.log.info("Shortcut removed", { combo = combo })

        -- Re-register
        pcall(overlord.bus.emit, "shortcuts:register", {
            pluginId  = overlord.manifest.id,
            shortcuts = shortcuts,
            groups    = groupShortcuts(shortcuts)
        })

    -- -----------------------------------------------------------------------
    -- shortcuts:list
    -- -----------------------------------------------------------------------
    elseif command:match("^shortcuts:list") then
        local shortcuts = loadShortcuts() or {}

        pcall(overlord.bus.emit, "shortcuts:list", {
            pluginId  = overlord.manifest.id,
            shortcuts = shortcuts,
            groups    = groupShortcuts(shortcuts),
            count     = #shortcuts
        })
        overlord.log.info("Shortcut list emitted", { count = #shortcuts })

    -- -----------------------------------------------------------------------
    -- shortcuts:reset — restore factory defaults
    -- -----------------------------------------------------------------------
    elseif command:match("^shortcuts:reset") then
        saveShortcuts(DEFAULT_SHORTCUTS)

        pcall(overlord.bus.emit, "shortcuts:register", {
            pluginId  = overlord.manifest.id,
            shortcuts = DEFAULT_SHORTCUTS,
            groups    = groupShortcuts(DEFAULT_SHORTCUTS)
        })
        overlord.log.info("Shortcuts reset to defaults", { count = #DEFAULT_SHORTCUTS })
    end
end)

-- ---------------------------------------------------------------------------
-- onRoomEnter — Emit a contextual shortcut hint for the entered room
-- ---------------------------------------------------------------------------
registerHook("onRoomEnter", function(context)
    if not context or not context.roomId then
        return
    end

    -- Look up the room to show a relevant hint
    local ok, room = pcall(overlord.rooms.get, context.roomId)
    if not ok or not room then
        return
    end

    overlord.log.debug("Emitting shortcut hints for room", { roomId = room.id, roomName = room.name })

    pcall(overlord.bus.emit, "shortcuts:hint", {
        roomId   = room.id,
        roomName = room.name,
        message  = "Press Ctrl+K to open the command palette, or Ctrl+Shift+R to return to rooms."
    })
end)
