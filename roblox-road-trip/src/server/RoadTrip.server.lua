--[[
	Road Trip Racing (รถซิ่งเที่ยวทริป)  -- Script หลัก
	วางใน ServerScriptService ชื่อ RoadTrip
	ลูกของสคริปต์นี้ (ModuleScript ตั้งชื่อตรงตามนี้):
	  Config, Util, Roads, Props, Car, Gameplay
	ถ้าพังจะขึ้นกล่องแดงที่ล่างจอและใน Output
]]

local Workspace = game:GetService("Workspace")
local Players = game:GetService("Players")
local StarterGui = game:GetService("StarterGui")

print("[RoadTrip] เริ่มสร้างแมพ... (รอสักครู่)")

local function reportError(err)
	warn("[RoadTrip] เกิดข้อผิดพลาด: " .. tostring(err))
	local function addGui(parent)
		local g = Instance.new("ScreenGui")
		g.Name = "RoadTripError"
		g.ResetOnSpawn = false
		local l = Instance.new("TextLabel")
		l.Size = UDim2.new(1, -40, 0, 160)
		l.Position = UDim2.new(0, 20, 1, -180)
		l.BackgroundColor3 = Color3.fromRGB(120, 0, 0)
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextWrapped = true
		l.TextScaled = true
		l.Text = "RoadTrip ERROR: " .. tostring(err)
		l.Parent = g
		g.Parent = parent
	end
	addGui(StarterGui)
	for _, pl in ipairs(Players:GetPlayers()) do
		local pg = pl:FindFirstChildOfClass("PlayerGui")
		if pg then
			addGui(pg)
		end
	end
end

local function load(name)
	local mod = script:WaitForChild(name, 10)
	if not mod then
		error("ไม่พบ ModuleScript ชื่อ '" .. name .. "' ใต้สคริปต์ RoadTrip")
	end
	print("[RoadTrip] โหลด " .. name)
	return require(mod)
end

local ok, err = xpcall(function()
	local ctx = {}
	ctx.Config = load("Config")
	ctx.Util = load("Util")

	local old = Workspace:FindFirstChild("RoadTripWorld")
	if old then
		old:Destroy()
	end
	ctx.world = Instance.new("Folder")
	ctx.world.Name = "RoadTripWorld"
	ctx.world.Parent = Workspace
	ctx.F = {}
	for key, name in pairs({
		ground = "Ground", road = "Road", gates = "Checkpoints", boost = "BoostPads",
		pads = "CarSpawnPads", decor = "Decor", cars = "Cars",
	}) do
		ctx.F[key] = ctx.Util.folder(ctx.world, name)
	end

	load("Roads")(ctx)
	load("Props")(ctx)
	ctx.Car = load("Car")(ctx)
	load("Gameplay")(ctx)

	-- ลบพื้น/จุดเกิดเดิมของเทมเพลต แล้วให้ผู้เล่นเกิดใหม่ที่จุดเกิดของแมพ
	for _, name in ipairs({ "Baseplate", "SpawnLocation" }) do
		local obj = Workspace:FindFirstChild(name)
		if obj and obj ~= ctx.spawn then
			obj:Destroy()
		end
	end
	for _, pl in ipairs(Players:GetPlayers()) do
		task.spawn(function()
			pl:LoadCharacter()
		end)
	end
	print(string.format("[RoadTrip] สร้างแมพเสร็จ: ถนน %d studs, %d โซน", ctx.Config.TOTAL, #ctx.Config.ZONES))
end, debug.traceback)

if not ok then
	reportError(err)
end
