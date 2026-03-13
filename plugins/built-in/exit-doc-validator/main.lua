-- =============================================================================
-- Exit Doc Validator Plugin
-- =============================================================================
-- Overlord already validates exit documents against a base schema (required
-- fields, correct types). This plugin adds a SECOND layer of validation with
-- configurable business rules:
--
--   * Required fields that go beyond the schema (e.g., "risks", "next_steps")
--   * Minimum content length for key sections (no one-word summaries)
--   * Presence of evidence links (URLs, issue numbers, file paths)
--   * Per-room-type rules (architecture docs need diagrams, code-lab docs
--     need test results, etc.)
--
-- When validation fails, the plugin emits an "exitdoc:validation-failed" event
-- with a detailed breakdown of what went wrong, so the agent or user can fix
-- the document before the phase advances.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuration defaults
-- ---------------------------------------------------------------------------
--   validator_enabled      (boolean)  Master on/off switch. Default: true
--   min_summary_length     (number)   Minimum characters for the "summary"
--                                     field. Default: 50
--   min_section_length     (number)   Minimum characters for any required
--                                     section. Default: 20
--   require_evidence_links (boolean)  Whether at least one URL, issue ref,
--                                     or file path must appear. Default: true
--   extra_required_fields  (table)    Additional field names that must be
--                                     present in every exit doc.
--                                     Default: {"summary", "status", "next_steps"}
--   room_rules             (table)    Per-room-type rule overrides.
--                                     Example:
--                                     {
--                                       ["architecture"] = {
--                                         extra_required_fields = {"diagrams", "decisions"},
--                                         min_summary_length = 100
--                                       }
--                                     }
-- ---------------------------------------------------------------------------

--- Read a config value from storage with a fallback default.
-- @param key      string  Storage key.
-- @param default  any     Fallback value.
-- @return any
local function getConfig(key, default)
    local value = overlord.storage.get(key)
    if value == nil then
        return default
    end
    return value
end

-- ---------------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------------

--- Check that a string field meets a minimum character length.
-- @param value      any     The field value to check.
-- @param minLength  number  The minimum number of characters required.
-- @param fieldName  string  Human-readable name for error messages.
-- @return string|nil        An error message, or nil if the check passes.
local function checkMinLength(value, minLength, fieldName)
    if value == nil then
        return fieldName .. " is missing"
    end
    if type(value) ~= "string" then
        return fieldName .. " must be a string (got " .. type(value) .. ")"
    end
    if #value < minLength then
        return fieldName .. " is too short (" .. #value .. " chars, minimum " .. minLength .. ")"
    end
    return nil
end

--- Check whether a string contains at least one evidence link.
-- Evidence links are: URLs (http/https), GitHub issue references (#123),
-- or file paths (containing / or \ with a file extension).
-- @param text  string  The text to scan.
-- @return boolean      True if at least one evidence pattern is found.
local function containsEvidenceLink(text)
    if type(text) ~= "string" then
        return false
    end

    -- Check for URLs
    if string.find(text, "https?://") then
        return true
    end

    -- Check for GitHub-style issue/PR references (#123)
    if string.find(text, "#%d+") then
        return true
    end

    -- Check for file paths (e.g., src/core/config.ts, ./output/report.pdf)
    if string.find(text, "[%w_%-]+/[%w_%-]+%.%w+") then
        return true
    end

    return false
end

--- Scan all string values in a document for evidence links.
-- @param doc  table  The exit document to scan.
-- @return boolean    True if evidence was found anywhere in the doc.
local function documentContainsEvidence(doc)
    for _, value in pairs(doc) do
        if type(value) == "string" and containsEvidenceLink(value) then
            return true
        end
        -- Also check nested tables (one level deep).
        if type(value) == "table" then
            for _, subValue in pairs(value) do
                if type(subValue) == "string" and containsEvidenceLink(subValue) then
                    return true
                end
            end
        end
    end
    return false
end

-- ---------------------------------------------------------------------------
-- Core validation logic
-- ---------------------------------------------------------------------------

--- Validate an exit document against all configured rules.
-- @param doc       table   The exit document content.
-- @param roomType  string  The type of room the document belongs to.
-- @return boolean          True if validation passed.
-- @return table            Array of error message strings (empty on success).
local function validateExitDoc(doc, roomType)
    local errors = {}

    -- Merge global config with any room-type-specific overrides.
    local roomRules = getConfig("room_rules", {})
    local overrides = roomRules[roomType] or {}

    -- Determine the effective settings for this room type.
    local requiredFields = overrides.extra_required_fields
        or getConfig("extra_required_fields", { "summary", "status", "next_steps" })

    local minSummaryLen = overrides.min_summary_length
        or getConfig("min_summary_length", 50)

    local minSectionLen = overrides.min_section_length
        or getConfig("min_section_length", 20)

    local requireEvidence = getConfig("require_evidence_links", true)
    if overrides.require_evidence_links ~= nil then
        requireEvidence = overrides.require_evidence_links
    end

    -- 1. Check that all required fields are present and non-empty.
    for _, fieldName in ipairs(requiredFields) do
        local value = doc[fieldName]
        if value == nil then
            table.insert(errors, "Required field \"" .. fieldName .. "\" is missing")
        elseif type(value) == "string" and #value == 0 then
            table.insert(errors, "Required field \"" .. fieldName .. "\" is empty")
        end
    end

    -- 2. Check minimum length on the summary field specifically.
    if doc.summary ~= nil then
        local lengthErr = checkMinLength(doc.summary, minSummaryLen, "summary")
        if lengthErr then
            table.insert(errors, lengthErr)
        end
    end

    -- 3. Check minimum length on all other required string fields.
    for _, fieldName in ipairs(requiredFields) do
        if fieldName ~= "summary" and doc[fieldName] ~= nil then
            local lengthErr = checkMinLength(doc[fieldName], minSectionLen, fieldName)
            if lengthErr then
                table.insert(errors, lengthErr)
            end
        end
    end

    -- 4. Check for evidence links if required.
    if requireEvidence then
        if not documentContainsEvidence(doc) then
            table.insert(errors, "No evidence links found. Include at least one URL, issue reference (#123), or file path.")
        end
    end

    local passed = (#errors == 0)
    return passed, errors
end

-- ---------------------------------------------------------------------------
-- Tool-execution hook: intercept exit document submissions
-- ---------------------------------------------------------------------------
-- Exit documents in Overlord are typically submitted via a tool execution
-- (e.g., "submit_exit_document"). We intercept that specific tool to validate
-- the document payload before it is accepted.
-- ---------------------------------------------------------------------------

--- Determine if a tool execution is an exit document submission.
-- @param data  table  The onToolExecute hook payload.
-- @return boolean
local function isExitDocSubmission(data)
    -- Common tool names for exit document submission.
    local exitDocTools = {
        submit_exit_document = true,
        submit_exit_doc = true,
        exit_document = true,
        create_exit_document = true,
    }

    local toolName = data.toolName or data.tool or ""
    return exitDocTools[toolName] == true
end

--- Handle the validation of an exit document tool execution.
-- @param data  table  The onToolExecute hook payload.
local function handleExitDocTool(data)
    local enabled = getConfig("validator_enabled", true)
    if not enabled then
        overlord.log.debug("Exit doc validator is disabled.")
        return
    end

    -- Extract the document content from the tool execution payload.
    -- The document may be in data.args, data.input, or data.result depending
    -- on how the tool was called.
    local doc = data.args or data.input or data.result or {}
    if type(doc) ~= "table" then
        overlord.log.warn("Exit document payload is not a table; cannot validate.", {
            roomId = data.roomId,
            payloadType = type(doc),
        })
        return
    end

    -- Determine the room type for room-specific rules.
    local roomType = "unknown"
    if data.roomId then
        local ok, room = pcall(overlord.rooms.get, data.roomId)
        if ok and room then
            roomType = room.type or "unknown"
        end
    end

    -- Run validation.
    local passed, errors = validateExitDoc(doc, roomType)

    if passed then
        overlord.log.info("Exit document passed custom validation.", {
            roomId = data.roomId,
            roomType = roomType,
        })

        -- Track successful validations for reporting.
        local stats = getConfig("validation_stats", { passed = 0, failed = 0 })
        stats.passed = (stats.passed or 0) + 1
        overlord.storage.set("validation_stats", stats)
        return
    end

    -- Validation failed -- log and emit event.
    overlord.log.warn("Exit document failed custom validation.", {
        roomId = data.roomId,
        roomType = roomType,
        errorCount = #errors,
        errors = errors,
    })

    overlord.bus.emit("exitdoc:validation-failed", {
        roomId = data.roomId,
        roomType = roomType,
        errors = errors,
        errorCount = #errors,
        documentFields = {},  -- We intentionally do not leak full doc content.
        triggeredBy = overlord.manifest.id,
        timestamp = os.time(),
    })

    -- Track failed validations.
    local stats = getConfig("validation_stats", { passed = 0, failed = 0 })
    stats.failed = (stats.failed or 0) + 1
    overlord.storage.set("validation_stats", stats)

    -- Store the most recent failure for debugging.
    overlord.storage.set("last_validation_failure", {
        roomId = data.roomId,
        roomType = roomType,
        errors = errors,
        timestamp = os.time(),
    })
end

-- ---------------------------------------------------------------------------
-- Lifecycle hooks
-- ---------------------------------------------------------------------------

registerHook("onLoad", function()
    overlord.log.info("Exit Doc Validator plugin loaded.", {
        version = overlord.manifest.version,
        enabled = getConfig("validator_enabled", true),
        requiredFields = getConfig("extra_required_fields", { "summary", "status", "next_steps" }),
        minSummaryLength = getConfig("min_summary_length", 50),
        requireEvidence = getConfig("require_evidence_links", true),
    })

    -- Initialize stats if they do not exist.
    if overlord.storage.get("validation_stats") == nil then
        overlord.storage.set("validation_stats", { passed = 0, failed = 0 })
    end
end)

registerHook("onUnload", function()
    local stats = getConfig("validation_stats", { passed = 0, failed = 0 })
    overlord.log.info("Exit Doc Validator plugin unloaded.", {
        totalPassed = stats.passed,
        totalFailed = stats.failed,
    })
end)

-- onToolExecute: Check every tool execution to see if it is an exit document
-- submission. If it is, run our custom validation pipeline.
registerHook("onToolExecute", function(data)
    -- Quick check: is this tool relevant?
    if not isExitDocSubmission(data) then
        return
    end

    local ok, err = pcall(handleExitDocTool, data)
    if not ok then
        overlord.log.error("Error in exit-doc-validator onToolExecute handler.", {
            error = tostring(err),
            roomId = data.roomId,
        })
    end
end)
