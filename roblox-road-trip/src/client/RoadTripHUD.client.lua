--[[
	HUD ฝั่งผู้เล่น -> วางใน StarterPlayer > StarterPlayerScripts
	แสดงโซนปัจจุบัน, เช็คพอยต์, ความเร็ว และข้อความแจ้งเตือน
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local STUDS_TO_KMH = 0.28 * 3.6

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
	l.TextColor3 = Color3.fromRGB(255, 255, 255)
	l.Font = Enum.Font.GothamBold
	l.TextSize = textSize
	l.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = l
	return l
end

local zoneLabel = label("Zone", UDim2.fromOffset(260, 44), UDim2.new(0.5, 0, 0, 12), Vector2.new(0.5, 0), 22)
local cpLabel = label("Checkpoint", UDim2.fromOffset(260, 28), UDim2.new(0.5, 0, 0, 62), Vector2.new(0.5, 0), 16)
local speedLabel = label("Speed", UDim2.fromOffset(150, 70), UDim2.new(1, -20, 1, -20), Vector2.new(1, 1), 30)
local toast = label("Toast", UDim2.fromOffset(420, 46), UDim2.new(0.5, 0, 0.22, 0), Vector2.new(0.5, 0.5), 20)
toast.BackgroundTransparency = 1
toast.TextTransparency = 1
toast.TextStrokeTransparency = 1

local function refreshStatic()
	local zone = player:GetAttribute("Zone") or "City"
	local thai = player:GetAttribute("ZoneThai") or ""
	zoneLabel.Text = string.format("%s · %s", zone, thai)
	cpLabel.Text = string.format("เช็คพอยต์ %d / %d", player:GetAttribute("Checkpoint") or 0,
		player:GetAttribute("CheckpointTotal") or 0)
end

player:GetAttributeChangedSignal("Zone"):Connect(refreshStatic)
player:GetAttributeChangedSignal("ZoneThai"):Connect(refreshStatic)
player:GetAttributeChangedSignal("Checkpoint"):Connect(refreshStatic)
player:GetAttributeChangedSignal("CheckpointTotal"):Connect(refreshStatic)
refreshStatic()

local toastToken = 0
player:GetAttributeChangedSignal("Toast"):Connect(function()
	local text = player:GetAttribute("Toast")
	if not text then
		return
	end
	toastToken = toastToken + 1
	local mine = toastToken
	toast.Text = text
	toast.BackgroundTransparency = 0.25
	toast.TextTransparency = 0
	task.delay(3, function()
		if mine == toastToken then
			TweenService:Create(toast, TweenInfo.new(0.6), { BackgroundTransparency = 1, TextTransparency = 1 }):Play()
		end
	end)
end)

RunService.RenderStepped:Connect(function()
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	local seat = hum and hum.SeatPart
	if seat and seat:IsA("VehicleSeat") then
		local kmh = math.floor(seat.AssemblyLinearVelocity.Magnitude * STUDS_TO_KMH)
		local boosting = seat.Parent:GetAttribute("Boosting")
		speedLabel.Text = string.format("%d km/h", kmh)
		speedLabel.TextColor3 = boosting and Color3.fromRGB(0, 230, 255) or Color3.fromRGB(255, 255, 255)
		speedLabel.Visible = true
	else
		speedLabel.Visible = false
	end
end)
