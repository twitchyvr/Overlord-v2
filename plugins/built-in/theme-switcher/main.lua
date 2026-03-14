-- =============================================================================
-- Theme Switcher — Overlord Plugin
-- =============================================================================
-- This plugin lets you create, store, and switch between custom colour themes
-- for the Overlord interface.
--
-- HOW IT WORKS:
--   1. On load, the plugin reads all saved themes from storage and emits a
--      "theme:register" event for each one so the frontend knows they exist.
--   2. When a tool is executed with the command "theme:switch <name>", the
--      plugin looks up that theme and emits a "theme:switch" event so the
--      frontend applies the new colours.
--   3. Themes are stored as JSON strings in plugin storage under the key
--      "themes".  You can add, edit, or remove themes by updating that key.
--
-- DEFAULT THEMES (created on first load):
--   - Overlord Dark   — deep navy and electric blue
--   - Overlord Light  — clean white with soft grey
--   - Sunset          — warm oranges and purples
--   - Ocean           — teal and aquamarine
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: simple JSON-ish serialisation for theme tables
-- We keep it minimal so the plugin has no external dependencies.
-- ---------------------------------------------------------------------------

--- Encode a flat key-value table as a JSON string.
local function encodeTheme(t)
    local parts = {}
    for k, v in pairs(t) do
        -- Escape double quotes inside values just in case
        local safeVal = tostring(v):gsub('"', '\\"')
        table.insert(parts, '"' .. tostring(k) .. '":"' .. safeVal .. '"')
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

--- Encode an array of theme tables as a JSON array string.
local function encodeThemeList(list)
    local encoded = {}
    for _, theme in ipairs(list) do
        table.insert(encoded, encodeTheme(theme))
    end
    return "[" .. table.concat(encoded, ",") .. "]"
end

--- Decode a JSON array string back into a Lua table of themes.
--- This is intentionally simple — it handles the flat structure we produce.
local function decodeThemeList(raw)
    if not raw or raw == "" then
        return nil
    end

    local themes = {}
    -- Match each {...} object inside the array
    for obj in raw:gmatch("{(.-)}") do
        local theme = {}
        -- Match "key":"value" pairs
        for key, value in obj:gmatch('"([^"]+)":"([^"]*)"') do
            theme[key] = value
        end
        if theme.name then
            table.insert(themes, theme)
        end
    end

    if #themes == 0 then
        return nil
    end
    return themes
end

-- ---------------------------------------------------------------------------
-- Default themes — created when the plugin runs for the first time
-- ---------------------------------------------------------------------------
local DEFAULT_THEMES = {
    {
        name         = "Overlord Dark",
        primaryColor = "#0f172a",
        accentColor  = "#3b82f6",
        surfaceColor = "#1e293b"
    },
    {
        name         = "Overlord Light",
        primaryColor = "#ffffff",
        accentColor  = "#2563eb",
        surfaceColor = "#f1f5f9"
    },
    {
        name         = "Sunset",
        primaryColor = "#1a0a2e",
        accentColor  = "#f97316",
        surfaceColor = "#2d1b4e"
    },
    {
        name         = "Ocean",
        primaryColor = "#042f2e",
        accentColor  = "#2dd4bf",
        surfaceColor = "#134e4a"
    }
}

-- ---------------------------------------------------------------------------
-- Storage helpers
-- ---------------------------------------------------------------------------

--- Load all themes from plugin storage. Returns a table of themes or nil.
local function loadThemes()
    local ok, raw = pcall(overlord.storage.get, "themes")
    if not ok or not raw then
        return nil
    end
    return decodeThemeList(raw)
end

--- Save a list of themes to plugin storage.
local function saveThemes(themes)
    local encoded = encodeThemeList(themes)
    local ok, err = pcall(overlord.storage.set, "themes", encoded)
    if not ok then
        overlord.log.error("Failed to save themes to storage", { error = tostring(err) })
        return false
    end
    return true
end

--- Load the name of the currently active theme.
local function loadActiveTheme()
    local ok, name = pcall(overlord.storage.get, "active_theme")
    if ok and name then
        return name
    end
    return nil
end

--- Persist the currently active theme name.
local function saveActiveTheme(name)
    local ok, err = pcall(overlord.storage.set, "active_theme", name)
    if not ok then
        overlord.log.warn("Could not persist active theme", { error = tostring(err) })
    end
end

-- ---------------------------------------------------------------------------
-- Theme lookup
-- ---------------------------------------------------------------------------

--- Find a theme by name (case-insensitive).
local function findTheme(themes, name)
    local lowerName = name:lower()
    for _, theme in ipairs(themes) do
        if theme.name:lower() == lowerName then
            return theme
        end
    end
    return nil
end

-- ---------------------------------------------------------------------------
-- Event helpers
-- ---------------------------------------------------------------------------

--- Emit a theme:register event for a single theme so the frontend adds it
--- to the theme picker.
local function emitThemeRegister(theme, isActive)
    local ok, err = pcall(overlord.bus.emit, "theme:register", {
        name         = theme.name,
        primaryColor = theme.primaryColor,
        accentColor  = theme.accentColor,
        surfaceColor = theme.surfaceColor,
        active       = isActive or false
    })
    if not ok then
        overlord.log.error("Failed to emit theme:register", {
            theme = theme.name,
            error = tostring(err)
        })
    end
end

--- Emit a theme:switch event so the frontend applies a theme.
local function emitThemeSwitch(theme)
    local ok, err = pcall(overlord.bus.emit, "theme:switch", {
        name         = theme.name,
        primaryColor = theme.primaryColor,
        accentColor  = theme.accentColor,
        surfaceColor = theme.surfaceColor
    })
    if not ok then
        overlord.log.error("Failed to emit theme:switch", {
            theme = theme.name,
            error = tostring(err)
        })
        return false
    end
    return true
end

-- =============================================================================
-- Lifecycle Hooks
-- =============================================================================

-- ---------------------------------------------------------------------------
-- onLoad — Initialise default themes (if needed) and register them all
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
    overlord.log.info("Theme Switcher loading", {
        pluginId = overlord.manifest.id,
        version  = overlord.manifest.version
    })

    -- Load saved themes, or seed with defaults on first run
    local themes = loadThemes()
    if not themes then
        overlord.log.info("No saved themes found — creating defaults")
        themes = DEFAULT_THEMES
        saveThemes(themes)
    end

    -- Determine which theme is currently active
    local activeName = loadActiveTheme() or "Overlord Dark"

    -- Register every theme with the frontend
    for _, theme in ipairs(themes) do
        local isActive = (theme.name:lower() == activeName:lower())
        emitThemeRegister(theme, isActive)
        overlord.log.debug("Registered theme", {
            name   = theme.name,
            active = isActive
        })
    end

    -- Apply the active theme immediately
    local activeTheme = findTheme(themes, activeName)
    if activeTheme then
        emitThemeSwitch(activeTheme)
        overlord.log.info("Applied active theme", { name = activeTheme.name })
    end

    overlord.log.info("Theme Switcher ready", { themeCount = #themes })
end)

-- ---------------------------------------------------------------------------
-- onUnload — Nothing to clean up; themes persist in storage
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
    overlord.log.info("Theme Switcher unloaded")
end)

-- ---------------------------------------------------------------------------
-- onToolExecute — Listen for theme-related commands
--
-- Supported command patterns (passed as context.command or context.args):
--   "theme:switch <Theme Name>"   — switch to an existing theme
--   "theme:add <name>|<primary>|<accent>|<surface>" — add a new theme
--   "theme:list"                  — emit a list of all themes
--   "theme:remove <Theme Name>"   — remove a custom theme
-- ---------------------------------------------------------------------------
registerHook("onToolExecute", function(context)
    -- Safely extract the command string from context
    local command = ""
    if context then
        command = context.command or context.args or ""
    end

    -- Ignore tool executions that are not theme commands
    if not command:match("^theme:") then
        return
    end

    overlord.log.debug("Theme command received", { command = command })

    -- -----------------------------------------------------------------------
    -- theme:switch <name>
    -- -----------------------------------------------------------------------
    if command:match("^theme:switch") then
        local themeName = command:match("^theme:switch%s+(.+)$")
        if not themeName then
            overlord.log.warn("theme:switch requires a theme name")
            return
        end

        local themes = loadThemes()
        if not themes then
            overlord.log.error("No themes available to switch to")
            return
        end

        local theme = findTheme(themes, themeName)
        if not theme then
            overlord.log.warn("Theme not found", { requested = themeName })
            return
        end

        if emitThemeSwitch(theme) then
            saveActiveTheme(theme.name)
            overlord.log.info("Switched theme", { name = theme.name })
        end

    -- -----------------------------------------------------------------------
    -- theme:add <name>|<primary>|<accent>|<surface>
    -- -----------------------------------------------------------------------
    elseif command:match("^theme:add") then
        local params = command:match("^theme:add%s+(.+)$")
        if not params then
            overlord.log.warn("theme:add requires name|primaryColor|accentColor|surfaceColor")
            return
        end

        local parts = {}
        for part in params:gmatch("[^|]+") do
            table.insert(parts, part:match("^%s*(.-)%s*$"))  -- trim whitespace
        end

        if #parts < 4 then
            overlord.log.warn("theme:add requires 4 pipe-separated values", { received = #parts })
            return
        end

        local newTheme = {
            name         = parts[1],
            primaryColor = parts[2],
            accentColor  = parts[3],
            surfaceColor = parts[4]
        }

        local themes = loadThemes() or {}

        -- Prevent duplicates
        if findTheme(themes, newTheme.name) then
            overlord.log.warn("Theme already exists", { name = newTheme.name })
            return
        end

        table.insert(themes, newTheme)
        saveThemes(themes)
        emitThemeRegister(newTheme, false)
        overlord.log.info("New theme added", { name = newTheme.name })

    -- -----------------------------------------------------------------------
    -- theme:list
    -- -----------------------------------------------------------------------
    elseif command:match("^theme:list") then
        local themes = loadThemes() or {}
        local activeName = loadActiveTheme() or ""
        local names = {}
        for _, theme in ipairs(themes) do
            table.insert(names, theme.name)
        end

        overlord.bus.emit("theme:list", {
            themes     = themes,
            active     = activeName,
            themeNames = names
        })
        overlord.log.info("Theme list emitted", { count = #themes })

    -- -----------------------------------------------------------------------
    -- theme:remove <name>
    -- -----------------------------------------------------------------------
    elseif command:match("^theme:remove") then
        local themeName = command:match("^theme:remove%s+(.+)$")
        if not themeName then
            overlord.log.warn("theme:remove requires a theme name")
            return
        end

        local themes = loadThemes()
        if not themes then
            overlord.log.warn("No themes to remove from")
            return
        end

        local newThemes = {}
        local found = false
        for _, theme in ipairs(themes) do
            if theme.name:lower() == themeName:lower() then
                found = true
            else
                table.insert(newThemes, theme)
            end
        end

        if not found then
            overlord.log.warn("Theme not found for removal", { requested = themeName })
            return
        end

        saveThemes(newThemes)
        overlord.bus.emit("theme:removed", { name = themeName })
        overlord.log.info("Theme removed", { name = themeName })
    end
end)
