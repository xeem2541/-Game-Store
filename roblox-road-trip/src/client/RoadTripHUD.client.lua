--[[
	RoadTripHUD (LocalScript) -> StarterPlayer > StarterPlayerScripts
	แสดงโซน เช็คพอยต์ ความเร็ว และข้อความแจ้งเตือน
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local player = Players.LocalPlayer
local KMH = 0.28 * 3.6 -- studs/s -> km/h

local gui = Instance.new("ScreenGui")
gui.Name = "RoadTripHUD"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local function label(name, size, pos, anchor, textSize)
	local l = Instance.new("TextLabel")
	l.Name = name
	l.Size = size
	l.Position = pos
	l.AnchorPoint = anchor
	l.BackgroundColor3 = Color3.fromRGB(15, 15, 20)
	l.BackgroundTransparency = 0.35
	l.TextColor3 = Color3.new(1, 1, 1)
	l.Font = Enum.Font.GothamBold
	l.TextSize = textSize
	l.Parent = gui
	Instance.new("UICorner", l).CornerRadius = UDim.new(0, 10)
	return l
end

local zoneLabel = label("Zone", UDim2.fromOffset(280, 44), UDim2.new(0.5, 0, 0, 12), Vector2.new(0.5, 0), 22)
local cpLabel = label("Checkpoint", UDim2.fromOffset(280, 28), UDim2.new(0.5, 0, 0, 62), Vector2.new(0.5, 0), 16)
local speedLabel = label("Speed", UDim2.fromOffset(160, 70), UDim2.new(1, -20, 1, -20), Vector2.new(1, 1), 30)
local toast = label("Toast", UDim2.fromOffset(460, 46), UDim2.new(0.5, 0, 0.22, 0), Vector2.new(0.5, 0.5), 20)
toast.BackgroundTransparency = 1
toast.TextTransparency = 1

local function refresh()
	zoneLabel.Text = string.format("%s · %s", player:GetAttribute("Zone") or "City", player:GetAttribute("ZoneThai") or "เมือง")
	cpLabel.Text = string.format("เช็คพอยต์ %d / %d", player:GetAttribute("Checkpoint") or 0, player:GetAttribute("CheckpointTotal") or 0)
end
for _, a in ipairs({ "Zone", "ZoneThai", "Checkpoint", "CheckpointTotal" }) do
	player:GetAttributeChangedSignal(a):Connect(refresh)
end
refresh()

local token = 0
player:GetAttributeChangedSignal("Toast"):Connect(function()
	local text = player:GetAttribute("Toast")
	if not text then
		return
	end
	token = token + 1
	local mine = token
	toast.Text = text
	toast.BackgroundTransparency = 0.25
	toast.TextTransparency = 0
	task.delay(3, function()
		if mine == token then
			TweenService:Create(toast, TweenInfo.new(0.6), { BackgroundTransparency = 1, TextTransparency = 1 }):Play()
		end
	end)
end)

RunService.RenderStepped:Connect(function()
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	local seat = hum and hum.SeatPart
	if seat and seat:IsA("VehicleSeat") then
		speedLabel.Text = string.format("%d km/h", math.floor(seat.AssemblyLinearVelocity.Magnitude * KMH))
		local boosting = Workspace:GetServerTimeNow() < (seat.Parent:GetAttribute("BoostUntil") or 0)
		speedLabel.TextColor3 = boosting and Color3.fromRGB(0, 230, 255) or Color3.new(1, 1, 1)
		speedLabel.Visible = true
	else
		speedLabel.Visible = false
	end
end)
