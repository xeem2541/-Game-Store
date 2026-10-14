--[[
	Road Trip Racing (รถซิ่งเที่ยวทริป)
	Script หลัก -> วางใน ServerScriptService ชื่อ RoadTripBuilder
	มี ModuleScript 6 ตัวเป็นลูกของสคริปต์นี้ (ตั้งชื่อตามนี้เป๊ะ ๆ):
	  Config, World, Gates, Decor, Cars, PlayerSetup
	ตัวนี้แค่เรียกแต่ละโมดูลตามลำดับ ถ้าพังจะขึ้นกล่องแดงที่หน้าจอ
]]

local Workspace = game:GetService("Workspace")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Lighting = game:GetService("Lighting")
local StarterGui = game:GetService("StarterGui")

print("[RoadTrip] สคริปต์หลักเริ่มทำงาน กำลังสร้างแมพ... (รอสักครู่)")

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

local S = {
	Workspace = Workspace,
	Players = Players,
	RunService = RunService,
	Lighting = Lighting,
	StarterGui = StarterGui,
}

local ORDER = { "Config", "World", "Gates", "Decor", "Cars", "PlayerSetup" }

local ok, err = xpcall(function()
	for _, name in ipairs(ORDER) do
		local mod = script:WaitForChild(name, 10)
		if not mod then
			error("ไม่พบ ModuleScript ชื่อ '" .. name .. "' ใต้สคริปต์ RoadTripBuilder")
		end
		print("[RoadTrip] กำลังโหลดส่วน " .. name)
		require(mod)(S)
	end
end, debug.traceback)

if not ok then
	reportError(err)
end
